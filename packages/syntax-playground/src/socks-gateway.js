// https://www.ietf.org/rfc/rfc1928.txt

const { currentFacet, genUuid, Bytes, Map, Observe, Skeleton } = require("@syndicate-lang/core");
const C = activate require("@syndicate-lang/server/lib/client");
const S = activate require("@syndicate-lang/driver-streams-node");
const debugFactory = require('debug');

assertion type VirtualTcpAddress(host, port);
assertion type AddressMap(from, nodeId, to);

assertion type ToNode(nodeId, assertion);
assertion type FromNode(nodeId, assertion);
assertion type RestrictedFromNode(nodeId, spec, captures);

function usage() {
  console.info('Usage: syndicate-socks-gateway --server WEBSOCKETURL SCOPE');
  console.info('');
  console.info('  --help, -h            Produce this message and terminate');
}

let server_url = null;
let server_scope = null;
function process_command_line(args) {
  const notUndefined = (x, w) => {
    if (x === void 0) {
      console.error('Missing '+w+' argument on command line');
      usage();
      process.exit(1);
    }
    return x;
  };
  const strArg = (w) => notUndefined(args.shift(), w);
  const numArg = (w) => Number.parseInt(notUndefined(args.shift(), w));
  while (args.length) {
    const opt = args.shift();
    switch (opt) {
      case '--server':
        server_url = strArg('server WebSocket URL');
        server_scope = strArg('server scope name');
        break;
      default:
        console.error("Unsupported command-line argument: " + opt);
        /* FALL THROUGH */
      case '--help':
      case '-h':
        usage();
        process.exit(1);
    }
  }
}

process_command_line(process.argv.slice(2));
if (!server_url || !server_scope) {
  usage();
  process.exit(1);
}
const server_addr = C.WSServer(server_url, server_scope);

spawn named 'socks-server' {
  on asserted S.Stream($conn, S.Incoming(S.TcpListener(1080))) {
    spawn named ['socksconn', conn] {
      const self = this;

      on start console.log('new SOCKS connection', conn);
      on stop console.log('closing SOCKS connection', conn);

      const rootFacet = currentFacet();

      stop on retracted S.Stream(conn, S.Duplex());

      const buf = S.onStartSpawnBufferStream();
      field this.bufferWanted = true;
      on start react {
        stop on (!this.bufferWanted);
        assert Observe(S.Stream(buf, S.Duplex()));
        on message S.Stream(conn, S.Data($chunk)) send S.Stream(buf, S.Push(chunk, false));
      }

      on start selectAuthenticationMethod();

      function readChunk(size, k) {
        react {
          on start send S.Stream(buf, S.PacketRequest(size));
          stop on message S.Stream(buf, S.Data($chunk)) {
            k(chunk);
          }
        }
      }

      function sendReply(replyCode, addrTypeAddrPort) {
        send S.Stream(conn, S.Push(Bytes.concat([
          Bytes.from([5, replyCode, 0]),
          (addrTypeAddrPort || Bytes.from([1, 0,0,0,0, 0,0]))
        ]), false));
      }

      function dieOnBadVersion(packet) {
        if (packet.get(0) !== 5) throw new Error("Bad SOCKS version number", packet.get(0));
      }

      function selectAuthenticationMethod() {
        readChunk(2, (versionMsg) => {
          dieOnBadVersion(versionMsg);
          const nMethods = versionMsg.get(1);
          readChunk(nMethods, (methods) => {
            if (!methods.includes(0)) {
              console.error('Client will not accept no-authentication');
              send S.Stream(conn, S.Push(Bytes.from([5, 255]), false));
              rootFacet.stop();
            } else {
              send S.Stream(conn, S.Push(Bytes.from([5, 0]), false)); // select no-authentication
              readSocksRequest();
            }
          });
        });
      }

      function readSocksRequest() {
        readChunk(4, (reqHeader) => {
          dieOnBadVersion(reqHeader);
          const cmdByte = reqHeader.get(1);
          if (reqHeader.get(2) !== 0) throw new Error("Non-zero reserved SOCKS byte");
          const addrType = reqHeader.get(3);
          switch (cmdByte) {
            case 1: // connect
              readDestAddrAndPort(addrType, startConnection);
              break;

            case 2: // bind
            case 3: // udp associate
            default:
              console.error('Unsupported SOCKS command', cmdByte);
              sendReply(7 /* command not supported */);
              rootFacet.stop();
              break;
          }
        });
      }

      function readDestAddrAndPort(addrType, k) {
        switch (addrType) {
          case 3: // domain name
            readChunk(1, (octetCount) => {
              readChunk(octetCount.get(0), (domainNameBytes) => {
                const domainName = domainNameBytes.fromUtf8();
                readPort(domainName, k);
              });
            });
            break;

          case 1: // ipv4
            readChunk(4, (addrBytes) => {
              const addr = `${addrBytes.get(0)}.${addrBytes.get(1)}.${addrBytes.get(2)}.${addrBytes.get(3)}`;
              readPort(addr, k);
            });
            break;

          case 4: // ipv6
            console.error('Unsupported SOCKS address type', addrType);
            sendReply(8 /* address type not supported */);
            rootFacet.stop();
            break;
        }
      }

      function readPort(addr, k) {
        readChunk(2, (portBytes) => {
          const port = (portBytes.get(0) << 8) + portBytes.get(1);
          k(addr, port);
        });
      }

      function startConnection(addr, port) {
        react {
          console.log(conn, 'CONNECT', addr, port);
          const out = genUuid('out');
          assert S.Stream(out, S.Outgoing(VirtualTcpAddress(addr, port)));
          stop on message S.Stream(out, S.Rejected($err)) {
            console.error('Could not connect outgoing', addr, port, err);
            switch (err.code) {
              case 'ENETUNREACH':
                sendReply(3 /* network unreachable */);
                rootFacet.stop();
                break;
              case 'EHOSTUNREACH':
                sendReply(4 /* host unreachable */);
                rootFacet.stop();
                break;
              case 'ECONNREFUSED':
                sendReply(5 /* connection refused */);
                rootFacet.stop();
                break;
              default:
                // We could definitely send reply code 1, "general
                // SOCKS server failure" here, but ssh's own SOCKS
                // proxy just closes the connection, so let's jump off
                // the cliff ourselves.
                // sendReply(1 /* general SOCKS server failure */);
                rootFacet.stop();
                break;
            }
          }
          stop on message S.Stream(out, S.Accepted()) {
            react {
              on retracted S.Stream(out, S.Duplex()) rootFacet.stop();
              on asserted S.Stream(out, S.Info(_, $handle)) {
                const localAddrStr = handle.localAddress || '127.255.255.254';
                const localPort = handle.localPort || 0;
                let localAddr = null;
                if (localAddrStr.match(/^\d+\.\d+\.\d+\.\d+$/)) {
                  localAddr = Bytes.concat([
                    Bytes.from([1]), // ipv4 address
                    Bytes.from(localAddrStr.split(/\./).map(Number))
                  ]);
                } else {
                  localAddr = Bytes.concat([
                    Bytes.from([3]), // domain name
                    Bytes.from([localAddrStr.length]), // TODO: what if it's longer than 255?
                    Bytes.from(localAddrStr)
                  ]);
                }
                const localEnd = Bytes.concat([
                  localAddr,
                  Bytes.from([localPort >> 8, localPort & 255])
                ]);
                sendReply(0 /* success */, localEnd);
                readChunk(0, (firstChunk) => {
                  self.bufferWanted = false;
                  send S.Stream(out, S.Push(firstChunk, false));
                  react {
                    assert S.Stream(conn, S.BackPressure(out));
                    assert S.Stream(out, S.BackPressure(conn));
                    on message S.Stream(conn, S.Data($chunk)) {
                      send S.Stream(out, S.Push(chunk, false));
                    }
                    on message S.Stream(out, S.Data($chunk)) {
                      send S.Stream(conn, S.Push(chunk, false));
                    }
                  }
                });
              }
            }
          }
        }
      }
    }
  }
}

spawn named 'remap-service' {
  const debug = debugFactory('syndicate/server:socks:remap-service');
  field this.table = Map();

  function lc(va) {
    return VirtualTcpAddress(VirtualTcpAddress._host(va).toLowerCase(),
                             VirtualTcpAddress._port(va));
  }

  during C.ServerConnected(server_addr) {
    on asserted C.FromServer(server_addr, $entry(AddressMap(_, _, _))) {
      debug('+', entry.toString());
      this.table = this.table.set(lc(AddressMap._from(entry)), entry);
    }
    on retracted C.FromServer(server_addr, $entry(AddressMap(_, _, _))) {
      debug('-', entry.toString());
      this.table = this.table.remove(lc(AddressMap._from(entry)));
    }

    during S.Stream($id, S.Outgoing($a0(VirtualTcpAddress(_, _)))) {
      const a = lc(a0);
      const host = VirtualTcpAddress._host(a);
      const port = VirtualTcpAddress._port(a);
      if (host.endsWith('.fruit')) {
        if (this.table.has(a)) {
          const entry = this.table.get(a);
          const A = server_addr;
          const N = AddressMap._nodeId(entry);
          const L = id;
          const R = genUuid('proxiedStream');
          assert C.ToServer(A, ToNode(N, S.Stream(R, S.Outgoing(AddressMap._to(entry)))));
          stop on message C.FromServer(A, FromNode(N, S.Stream(R, S.Rejected($err)))) {
            send S.Stream(L, S.Rejected(err));
          }
          stop on message C.FromServer(A, FromNode(N, S.Stream(R, S.Accepted()))) {
            react {
              on start send S.Stream(L, S.Accepted());

              assert S.Stream(L, S.Info(Symbol.for("Duplex"), false)); // TODO

              assert S.Stream(L, S.Duplex());
              stop on retracted Observe(S.Stream(L, S.Duplex()));
              stop on retracted C.FromServer(A, FromNode(N, S.Stream(R, S.Duplex())));

              // Readable

              during Observe(S.Stream(L, S.End()))
                during C.FromServer(A, FromNode(N, S.Stream(R, S.End())))
                  assert S.Stream(L, S.End());

              on message S.Stream(L, S.Pushback($chunk))
                send C.ToServer(A, ToNode(N, S.Stream(R, S.Pushback(chunk))));

              during S.Stream(L, S.BackPressure($sinkL)) {
                const sinkR = genUuid('sink');
                assert C.ToServer(A, ToNode(N, S.Stream(R, S.BackPressure(sinkR))));
                field this.seqno = -1;
                field this.amount = 0;
                on asserted S.Stream(sinkL, S.Window($seqno, $amount)) {
                  this.seqno = seqno;
                  this.amount = amount;
                }
                assert C.ToServer(A, ToNode(N, S.Stream(sinkR, S.Window(this.seqno, this.amount))))
                  when (this.seqno >= 0);
              }

              during C.FromServer(A, FromNode(N, S.Stream(R, S.DataReady())))
                assert S.Stream(L, S.DataReady());

              during Observe(S.Stream(L, S.Data(_)))
                on message C.FromServer(A, FromNode(N, S.Stream(R, S.Data($chunk))))
                  send S.Stream(L, S.Data(chunk));

              // Writable

              during Observe(S.Stream(L, S.Window(_, _))) {
                field this.seqno = -1;
                field this.amount = 0;
                on asserted C.FromServer(A, FromNode(N, S.Stream(R, S.Window($seqno, $amount)))) {
                  this.seqno = seqno;
                  this.amount = amount;
                }
                assert S.Stream(L, S.Window(this.seqno, this.amount)) when (this.seqno >= 0);
              }

              const withCallback = (ackL, f) => {
                if (ackL === false) {
                  f(false);
                } else {
                  react {
                    const ackR = genUuid('ack');
                    on message C.FromServer(A, FromNode(N, ackR)) send ackL;
                    on start f(ackR);
                  }
                }
              }

              on message S.Stream(L, S.Push($chunk, $ackL)) {
                withCallback(ackL, (ackR) => {
                  send C.ToServer(A, ToNode(N, S.Stream(R, S.Push(chunk, ackR))));
                });
              }

              on message S.Stream(L, S.Close($ackL)) {
                withCallback(ackL, (ackR) => {
                  send C.ToServer(A, ToNode(N, S.Stream(R, S.Close(ackR))));
                });
              }
            }
          }
        } else {
          console.error("No virtual mapping for", a.toString());
          const err = new Error(`No virtual mapping for ${a.toString()}`);
          err.errno = err.code = 'ENOTFOUND';
          err.hostname = err.host = host;
          err.port = port;
          on start send S.Stream(id, S.Rejected(err));
        }
      } else {
        assert S.Stream(id, S.Outgoing(S.TcpAddress(host, port)));
      }
    }
  }
}

spawn named 'from-node-relay' {
  const debug = debugFactory('syndicate/server:socks:from-node-relay');
  during Observe(C.FromServer($addr, FromNode($node, $spec))) {
    on start debug('?+', addr.toString(), node.toString(), spec.toString());
    on stop debug('?-', addr.toString(), node.toString(), spec.toString());
    during C.FromServer(addr, RestrictedFromNode(node, spec.toString(), $vs)) {
      // ^ TODO: Use real quoting instead of spec.toString() hack!!
      // TODO: Shouldn't the dataspace/client be doing the necessary quoting for us??
      const a = Skeleton.instantiateAssertion(C.FromServer(addr, FromNode(node, spec)), vs);
      on start debug('+', a.toString());
      on stop debug('-', a.toString());
      assert a;
    }
    on message C.FromServer(addr, RestrictedFromNode(node, spec.toString(), $vs)) {
      const a = Skeleton.instantiateAssertion(C.FromServer(addr, FromNode(node, spec)), vs);
      debug('!', a.toString());
      send a;
    }
  }
}
