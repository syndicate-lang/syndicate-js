//---------------------------------------------------------------------------
// @syndicate-lang/driver-websocket, WebSocket client support for Syndicate/js
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

import { currentFacet, Bytes, Observe, Dataspace } from "@syndicate-lang/core";
const { sleep } = activate require("@syndicate-lang/driver-timer");

const _WebSocket = require('isomorphic-ws');

assertion type WebSocket(id, url, options);
message type DataIn(id, chunk);
message type DataOut(id, chunk);

Object.assign(module.exports, {
  WebSocket, DataIn, DataOut,
});

spawn named 'WebSocketFactory' {
  during Observe(WebSocket($id, $url, $options)) spawn named ['WebSocket', id, url] {
    const facet = currentFacet();

    let finish = Dataspace.backgroundTask();
    on stop finish();

    let ws = null;
    field this.connected = false;

    const connect = () => {
      disconnect();
      console.log('WebSocket', id, url, 'connecting');
      ws = new _WebSocket(url, options);

      ws.onerror = Dataspace.wrapExternal((e) => {
        console.error('WebSocket', id, url, e.message);
        disconnect();
        sleep(1000, connect);
      });

      ws.onopen = Dataspace.wrapExternal(() => { this.connected = true; });
      ws.onclose = Dataspace.wrapExternal(() => { if (this.connected) { connect(); }});
      ws.onmessage = Dataspace.wrapExternal((data) => { ^ DataIn(id, Bytes.fromIO(data.data)); });
    };

    const disconnect = () => {
      if (ws) {
        try { ws.close(); } catch (_e) {}
        ws = null;
      }
      this.connected = false;
    };

    on start connect();
    on stop disconnect();

    assert WebSocket(id, url, options) when (this.connected);

    on message DataOut(id, $data) {
      if (this.connected) {
        ws.send(Bytes.toIO(data));
      }
    }
  }
}
