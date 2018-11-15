//---------------------------------------------------------------------------
// @syndicate-lang/syntax-test, a demo of Syndicate extensions to JS.
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

import { currentFacet, genUuid, Bytes } from "@syndicate-lang/core";

const WS = activate require("@syndicate-lang/driver-websocket");
const { PeriodicTick } = activate require("@syndicate-lang/driver-timer");

const url = "ws://localhost:8080/echo";

spawn named 'demo' {
  const wsId = genUuid('_wsClient');
  during WS.WebSocket(wsId, url, {}) {
    on start console.log("Connected!");
    on stop console.log("Disconnected.");

    on message WS.DataIn(wsId, $data) {
      console.log(data);
    }

    on message PeriodicTick(1000) {
      ^ WS.DataOut(wsId, Bytes.from(genUuid('timestamp')));
    }
  }
}
