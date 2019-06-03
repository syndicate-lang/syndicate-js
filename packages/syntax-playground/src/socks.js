// https://www.ietf.org/rfc/rfc1928.txt

const { currentFacet, genUuid, Bytes, List, Set, Observe } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

assertion type VirtualTcpAddress(host, port);

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
                const domainName = domainNameBytes.toString('utf-8');
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
  field this.mapped = Set();

  on asserted Observe(S.Stream(_, S.Outgoing($a(VirtualTcpAddress(_, _))))) {
    this.mapped = this.mapped.add(a);
  }
  on retracted Observe(S.Stream(_, S.Outgoing($a(VirtualTcpAddress(_, _))))) {
    this.mapped = this.mapped.remove(a);
  }

  during S.Stream($id, S.Outgoing($a(VirtualTcpAddress($host, $port)))) {
    if (host.endsWith('.fruit')) {
      if (!this.mapped.includes(a)) {
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

spawn named 'test-remap' {
  during S.Stream($id, S.Outgoing(VirtualTcpAddress('foobar.fruit', 9999))) {
    assert S.Stream(id, S.Outgoing(S.TcpAddress('steam.eighty-twenty.org', 22)));
  }

  during S.Stream($id, S.Outgoing(VirtualTcpAddress('foobar.fruit', 9998))) {
    assert S.Stream(id, S.Outgoing(S.SubprocessAddress('/bin/sh', [], {})));
  }

  during S.Stream($id, S.Outgoing(VirtualTcpAddress('foobar.fruit', 9997))) {
    assert S.Stream(id, S.Outgoing(S.SubprocessAddress('/bin/cat', ['/proc/cpuinfo'], {})));
  }
}
