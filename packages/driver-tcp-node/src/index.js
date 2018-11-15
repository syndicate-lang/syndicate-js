//---------------------------------------------------------------------------
// @syndicate-lang/driver-tcp-node, TCP support for Syndicate/js
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

const { sleep } = activate require("@syndicate-lang/driver-timer");

assertion type TcpConnection(id, spec);
assertion type TcpAccepted(id);
assertion type TcpRejected(id, reason);

message type LineIn(id, line);
message type DataIn(id, chunk);
message type DataOut(id, chunk);

assertion type TcpAddress(host, port);
assertion type TcpListener(port);

export {
  TcpConnection, TcpAccepted, TcpRejected,
  DataOut, DataIn, LineIn,
  TcpAddress, TcpListener,
};

spawn named 'driver/TcpDriver' {
  during Observe(TcpConnection(_, TcpListener($port))) spawn named ['driver/TcpListener', port] {
    let finish = Dataspace.backgroundTask();
    on stop finish();

    let server = net.createServer(Dataspace.wrapExternal((socket) => {
      let id = genUuid('tcp' + port);
      spawn named ['driver/TcpInbound', id] {
        assert TcpConnection(id, TcpListener(port));
        on asserted TcpAccepted(id) _connectionCommon.call(this, currentFacet(), id, socket, true);
        stop on retracted TcpAccepted(id);
        stop on asserted TcpRejected(id, _);
      }
    }));

    server.listen(port, '0.0.0.0');
    on stop try { server.close() } catch (e) { console.error(e); }
  }

  during TcpConnection($id, TcpAddress($host, $port))
  spawn named ['driver/TcpOutbound', id, host, port] {
    let finish = Dataspace.backgroundTask();
    on stop finish();

    let socket = new net.Socket();

    on start {
      socket.connect(port, host);
      _connectionCommon.call(this, currentFacet(), id, socket, false);
    }
  }

  during Observe(LineIn($id, _)) spawn named ['driver/TcpLineReader', id] {
    field this.buffer = Bytes();
    on message DataIn(id, $data) this.buffer = Bytes.concat([this.buffer, data]);
    dataflow {
      const pos = this.buffer.indexOf(10);
      if (pos !== -1) {
        const line = this.buffer.slice(0, pos);
        this.buffer = this.buffer.slice(pos + 1);
        ^ LineIn(id, line);
      }
    }
  }
}

function _connectionCommon(rootFacet, id, socket, established) {
  react {
    field this.ready = established;

    socket.on('ready', Dataspace.wrapExternal(() => {
      if (!established) react assert TcpAccepted(id);
      this.ready = true;
    }));
    socket.on('error', Dataspace.wrapExternal((err) => {
      if (!this.ready) {
        // Pre-connection error: "rejected"
        react assert TcpRejected(id, err);
      } else {
        // Post-establishment error
        console.error(err);
        rootFacet.stop();
      }
    }));
    socket.on('close', Dataspace.wrapExternal(() => { rootFacet.stop(); }));

    on stop try { socket.destroy() } catch (e) { console.error(e); }

    on start react stop on asserted Observe(DataIn(id, _)) {
      socket.on('data', Dataspace.wrapExternal((data) => {
        ^ DataIn(id, Bytes.fromIO(data));
      }));
    }

    on message DataOut(id, $data) {
      socket.write(Bytes.toIO(data));
    }
  }
}
