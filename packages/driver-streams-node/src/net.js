//---------------------------------------------------------------------------
// @syndicate-lang/driver-streams-node, Stream support for Syndicate/js
// Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

import { currentFacet, Observe, Dataspace, genUuid, Bytes } from "@syndicate-lang/core";
const S = activate require("./streams");
const net = require('net');
const fs = require('fs');

assertion type TcpAddress(host, port);
assertion type TcpListener(port);
export { TcpAddress, TcpListener };

assertion type UnixSocketClient(path);
assertion type UnixSocketServer(path);
export { UnixSocketClient, UnixSocketServer };

spawn named 'NetDriver' {
  during Observe(S.IncomingConnection(_, TcpListener($port))) spawn named ['TcpListener', port] {
    _netListener.call(this,
                      () => genUuid('tcp' + port),
                      TcpListener(port),
                      (server) => { server.listen(port, '0.0.0.0') },
                      (server, err) => { throw err; });
  }

  during Observe(S.IncomingConnection(_, UnixSocketServer($path)))
  spawn named ['UnixSocketServer', path] {
    let retried = false;
    _netListener.call(this,
                      () => genUuid('unix:' + path),
                      UnixSocketServer(path),
                      (server) => { server.listen(path) },
                      (server, err) => {
                        if (err.code === 'EADDRINUSE') {
                          // Potentially-stale socket file sitting around. Try
                          // connecting to it to see if it is alive, and remove it if
                          // not.
                          if (retried) {
                            // We're on our second go already, give up.
                            throw err;
                          } else {
                            retried = true;
                            const probe = new net.Socket();
                            function destroyProbe() {
                              try { probe.destroy() } catch (e) { console.error(e); }
                            }
                            probe.on('error', Dataspace.wrapExternal((e) => {
                              destroyProbe();
                              if (e.code === 'ECONNREFUSED') {
                                fs.unlinkSync(path);
                                server.listen(path);
                              } else {
                                // Something else went wrong! Give up the original listen.
                                console.error('Problem while probing potentially-stale socket', e);
                                throw err;
                              }
                            }));
                            probe.connect(path, Dataspace.wrapExternal(() => {
                              destroyProbe();
                              throw err;
                            }));
                          }
                        } else {
                          throw err;
                        }
                      });
  }

  function _netListener(idGenerator, spec, listenFun, errorHandler) {
    let finish = Dataspace.backgroundTask();
    on stop finish();

    let server = net.createServer(Dataspace.wrapExternal((socket) => {
      S.spawnConnection(idGenerator(), spec, socket);
    }));

    server.on('error', Dataspace.wrapExternal((err) => errorHandler(server, err)));
    listenFun(server);
    on stop try { server.close() } catch (e) { console.error(e); }
  }

  during S.OutgoingConnection($id, TcpAddress($host, $port)) spawn named ['Tcp', id, host, port] {
    _netConnector.call(this,
                       id,
                       (socket) => { socket.connect(port, host) },
                       TcpAddress(host, port));
  }

  during S.OutgoingConnection($id, UnixSocketClient($path)) spawn named ['Unix', id, path] {
    _netConnector.call(this,
                       id,
                       (socket) => { socket.connect(path) },
                       UnixSocketClient(path));
  }

  function _netConnector(id, connectFun, spec) {
    const establishingFacet = currentFacet();
    let finish = Dataspace.backgroundTask();

    const socket = new net.Socket();

    const connectionErrorHandler = Dataspace.wrapExternal((err) => {
      finish();
      establishingFacet.stop(() => {
        socket.destroy();
        send S.ConnectionRejected(id, err);
      });
    });

    on retracted S.OutgoingConnection(id, spec) {
      connectionErrorHandler(null);
    }

    on start {
      const readyHandler = Dataspace.wrapExternal(() => {
        socket.off('error', connectionErrorHandler);
        socket.off('ready', readyHandler);
        send S.ConnectionAccepted(id);
        establishingFacet.stop(() => {
          react {
            on stop finish();
            S.duplexStreamBehaviour(id, socket);
          }
        });
      });
      socket.on('error', connectionErrorHandler);
      socket.on('ready', readyHandler);
      connectFun(socket);
    }
  }
}
