// https://www.ietf.org/rfc/rfc1928.txt

const { currentFacet, genUuid, Bytes, List, Set, Observe } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

assertion type VirtualTcpAddress(host, port);

spawn named 'socks-server' {
  on asserted S.IncomingConnection($conn, S.TcpListener(1080)) {
    spawn named ['socksconn', conn] {
      const self = this;

      on start console.log('new SOCKS connection', conn);
      on stop console.log('closing SOCKS connection', conn);

      const rootFacet = currentFacet();

      stop on retracted S.Duplex(conn);

      const buf = S.spawnBufferStream();
      field this.bufferWanted = true;
      on start react {
        stop on (!this.bufferWanted);
        assert Observe(S.Duplex(buf));
        on message S.Data(conn, $chunk) send S.Push(buf, chunk, null);
      }

      on start selectAuthenticationMethod();

      function readChunk(size, k) {
        react {
          on start send S.PacketRequest(buf, size);
          stop on message S.Data(buf, $chunk) {
            k(chunk);
          }
        }
      }

      function sendReply(replyCode, addrTypeAddrPort) {
        send S.Push(conn, Bytes.concat([
          Bytes.from([5, replyCode, 0]),
          (addrTypeAddrPort || Bytes.from([1, 0,0,0,0, 0,0]))
        ]), null);
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
              send S.Push(conn, Bytes.from([5, 255]), null);
              rootFacet.stop();
            } else {
              send S.Push(conn, Bytes.from([5, 0]), null); // select no-authentication
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
          assert S.OutgoingConnection(out, VirtualTcpAddress(addr, port));
          stop on message S.ConnectionRejected(out, $err) {
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
          stop on message S.ConnectionAccepted(out) {
            react {
              on retracted S.Duplex(out) rootFacet.stop();
              on asserted S.StreamInfo(out, _, $handle) {
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
                  send S.Push(out, firstChunk, null);
                  react {
                    assert S.BackPressure(conn, out);
                    assert S.BackPressure(out, conn);
                    on message S.Data(conn, $chunk) send S.Push(out, chunk, null);
                    on message S.Data(out, $chunk) send S.Push(conn, chunk, null);
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

  on asserted Observe(S.OutgoingConnection(_, $a(VirtualTcpAddress(_, _)))) {
    this.mapped = this.mapped.add(a);
  }
  on retracted Observe(S.OutgoingConnection(_, $a(VirtualTcpAddress(_, _)))) {
    this.mapped = this.mapped.remove(a);
  }

  during S.OutgoingConnection($id, $a(VirtualTcpAddress($host, $port))) {
    if (host.endsWith('.fruit')) {
      if (!this.mapped.includes(a)) {
        console.error("No virtual mapping for", a.toString());
        const err = new Error(`No virtual mapping for ${a.toString()}`);
        err.errno = err.code = 'ENOTFOUND';
        err.hostname = err.host = host;
        err.port = port;
        // TODO: should error because no 'on start':
        send S.ConnectionRejected(id, err);
      }
    } else {
      assert S.OutgoingConnection(id, S.TcpAddress(host, port));
    }
  }
}

spawn named 'test-remap' {
  during S.OutgoingConnection($id, VirtualTcpAddress('foobar.fruit', 9999)) {
    assert S.OutgoingConnection(id, S.TcpAddress('steam.eighty-twenty.org', 22));
  }

  during S.OutgoingConnection($id, VirtualTcpAddress('foobar.fruit', 9998)) {
    assert S.OutgoingConnection(id, S.SubprocessAddress('/bin/sh', [], {}));
  }

  during S.OutgoingConnection($id, VirtualTcpAddress('foobar.fruit', 9997)) {
    assert S.OutgoingConnection(id, S.SubprocessAddress('/bin/cat', ['/proc/cpuinfo'], {}));
  }
}
