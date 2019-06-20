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
const debugFactory = require('debug');

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
    const debug = debugFactory('syndicate/driver-websocket:' + (id && id.toString()));

    let finish = Dataspace.backgroundTask();
    on stop finish();

    const DEFAULT_RECONNECT_DELAY = 1000; // milliseconds
    const MAX_RECONNECT_DELAY = 30000; // milliseconds

    let ws = null;
    field this.connected = false;
    field this.reconnectDelay = DEFAULT_RECONNECT_DELAY;

    const guard = (context, f) => {
      try {
        f()
      } catch (e) {
        // Swallow e, which will be some kind of websocket-related exception.
        debug('exception in actor '+facet.actor.toString()+' during '+context+':', e.message);
        facet.stop();
      }
    };

    const connect = () => {
      disconnect();
      debug(url, 'connecting');
      ws = new _WebSocket(url, [], options.toJS());

      ws.onerror = Dataspace.wrapExternal((e) => {
        debug(url, e.message);
        disconnect();
        if (this.reconnectDelay !== DEFAULT_RECONNECT_DELAY) {
          debug('Will reconnect in '+Math.floor(this.reconnectDelay)+' milliseconds');
        }
        sleep(Math.floor(this.reconnectDelay), connect);
        this.reconnectDelay = this.reconnectDelay * 1.618 + (Math.random() * 1000);
        this.reconnectDelay =
          this.reconnectDelay > MAX_RECONNECT_DELAY
          ? MAX_RECONNECT_DELAY + (Math.random() * 1000)
          : this.reconnectDelay;
      });

      ws.onopen = Dataspace.wrapExternal(() => {
        this.connected = true;
        this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
      });
      ws.onclose = Dataspace.wrapExternal(() => {
        if (this.connected) {
          connect();
        }
      });
      ws.onmessage = Dataspace.wrapExternal((data) => {
        if (typeof Blob !== 'undefined' && data.data instanceof Blob) {
          var reader = new FileReader();
          reader.addEventListener("loadend", Dataspace.wrapExternal(() => {
            send DataIn(id, Bytes.from(reader.result));
          }));
          reader.readAsArrayBuffer(data.data);
        } else {
          send DataIn(id, Bytes.fromIO(data.data));
        }
      });
    };

    const disconnect = () => {
      if (ws) {
        debug(url, 'disconnecting');
        guard('close', () => ws.close());
        ws = null;
      }
      this.connected = false;
    };

    on start connect();
    on stop disconnect();

    assert WebSocket(id, url, options) when (this.connected);

    on message DataOut(id, $data) {
      if (this.connected) {
        guard('send', () => ws.send(Bytes.toIO(data)));
      }
    }
  }
}
