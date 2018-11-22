//---------------------------------------------------------------------------
// @syndicate-lang/driver-unixsocket-node, Unix socket support for Syndicate/js
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
const net = require('net');
const fs = require('fs');

assertion type UnixSocketConnection(id, spec);
assertion type UnixSocketAccepted(id);
assertion type UnixSocketRejected(id, reason);

// message type LineIn(id, line); // TODO: abstract out this common protocol
message type DataIn(id, chunk);
message type DataOut(id, chunk);

assertion type UnixSocketClient(path);
assertion type UnixSocketServer(path);

export {
  UnixSocketConnection, UnixSocketAccepted, UnixSocketRejected,
  DataOut, DataIn,
  UnixSocketClient, UnixSocketServer,
};

spawn named 'driver/UnixSocketDriver' {
  during Observe(UnixSocketConnection(_, UnixSocketServer($path)))
  spawn named ['driver/UnixSocketServer', path] {
    let finish = Dataspace.backgroundTask();
    on stop finish();

    let server = net.createServer(Dataspace.wrapExternal((socket) => {
      let id = genUuid('unix:' + path);
      spawn named ['driver/UnixSocketInbound', id] {
        assert UnixSocketConnection(id, UnixSocketServer(path));
        on asserted UnixSocketAccepted(id) _connectionCommon.call(this, currentFacet(), id, socket, true);
        stop on retracted UnixSocketAccepted(id);
        stop on asserted UnixSocketRejected(id, _);
      }
    }));

    let retried = false;
    server.on('error', Dataspace.wrapExternal((err) => {
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
          probe.on('error', Dataspace.wrapExternal((e) => {
            if (e.code === 'ECONNREFUSED') {
              fs.unlinkSync(path);
              server.listen(path);
            } else {
              // Something else went wrong! Give up the original listen.
              console.error('Problem while probing potentially-stale socket', e);
              throw err;
            }
          }));
          probe.connect(path, Dataspace.wrapExternal((sock) => {
            try { sock.destroy() } catch (e) { console.error(e); }
            throw err;
          }));
        }
      } else {
        throw err;
      }
    }));
    server.listen(path);
    on stop try { server.close() } catch (e) { console.error(e); }
  }

  during UnixSocketConnection($id, UnixSocketClient($path))
  spawn named ['driver/UnixSocketOutbound', id, path] {
    let finish = Dataspace.backgroundTask();
    on stop finish();

    let socket = new net.Socket();

    on start {
      socket.connect(path);
      _connectionCommon.call(this, currentFacet(), id, socket, false);
    }
  }
}

function _connectionCommon(rootFacet, id, socket, established) {
  react {
    field this.ready = established;

    socket.on('ready', Dataspace.wrapExternal(() => {
      if (!established) react assert UnixSocketAccepted(id);
      this.ready = true;
    }));
    socket.on('error', Dataspace.wrapExternal((err) => {
      if (!this.ready) {
        // Pre-connection error: "rejected"
        react assert UnixSocketRejected(id, err);
      } else {
        // Post-establishment error
        if (err.errno !== 'ECONNRESET') {
          console.error(err);
        }
        rootFacet.stop();
      }
    }));
    socket.on('close', Dataspace.wrapExternal(() => { rootFacet.stop(); }));

    on stop try { socket.destroy() } catch (e) { console.error(e); }

    on start react stop on asserted Observe(DataIn(id, _)) {
      socket.on('data', Dataspace.wrapExternal((data) => { send DataIn(id, Bytes.fromIO(data)); }));
    }

    on message DataOut(id, $data) {
      socket.write(Bytes.toIO(data));
    }
  }
}
