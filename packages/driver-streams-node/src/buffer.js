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

import { currentFacet, Observe, genUuid, Bytes, List } from "@syndicate-lang/core";
const S = activate require("./streams");

message type PacketRequest(size);

export {
  PacketRequest,
};

export function onStartSpawnBufferStream() {
  const id = genUuid('buffer-stream');
  on start _spawnBufferStream(id);
  return id;
}

export function spawnBufferStream() {
  const id = genUuid('buffer-stream');
  _spawnBufferStream(id);
  return id;
}

function _spawnBufferStream(id) {
  spawn named id {
    stop on retracted Observe(S.Stream(id, S.Duplex()));
    assert S.Stream(id, S.Duplex());
    assert S.Stream(id, S.Info(Symbol.for('Duplex'), null));

    field this.buffer = Bytes();
    field this.queue = List();

    on message S.Stream(id, S.Push($chunk, $ack)) {
      this.buffer = Bytes.concat([this.buffer, chunk]);
      if (ack !== null) send ack;
    }

    stop on message S.Stream(id, S.Close($ack)) {
      if (ack !== false) send ack;
    }

    on message S.Stream(id, PacketRequest($size)) {
      if (size === 0) {
        // Signal to terminate.
        currentFacet().stop(() => { send S.Stream(id, S.Data(this.buffer)); });
      } else {
        this.queue = this.queue.push(size);
      }
    }

    dataflow {
      if (!this.queue.isEmpty()) {
        const expected = this.queue.first();
        if (this.buffer.size >= expected) {
          send S.Stream(id, S.Data(this.buffer.slice(0, expected)));
          this.buffer = this.buffer.slice(expected);
          this.queue = this.queue.shift();
        }
      }
    }
  }
  return id;
}
