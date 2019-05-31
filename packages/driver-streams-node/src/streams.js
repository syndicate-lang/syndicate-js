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

import {
  currentFacet, Observe, Dataspace, genUuid, Bytes,
  Map,
} from "@syndicate-lang/core";
const stream = require('stream');

assertion type Stream(id, detail); // for assertions and messages

assertion type Incoming(spec);
assertion type Outgoing(spec);
message type Accepted(); // for both incoming and outgoing connections
message type Rejected(err); // for both incoming and outgoing connections

// Each `chunk` to/from a stream in BINARY mode must be either a
// String or a Uint8Array (or Buffer). Any `chunk` may be empty
// (zero-length). A `chunk` must NEVER be `null`.
//
// Each `chunk` to/from a stream in OBJECT mode may be any value
// except `null`.
//
// Each `ack`, if non-`null`, is an acknowledgement MESSAGE to be sent
// when the corresponding chunk is completely processed.

// Interest in StreamInfo is non-creative
assertion type Info(kind, stream); // kind ∈ Readable, Writable, Duplex

// Framing knowledge; interest in these is creative
assertion type Readable() = Symbol.for('stream-readable');
assertion type Writable() = Symbol.for('stream-writable');
assertion type Duplex() = Symbol.for('stream-duplex');

message type Error(detail) = Symbol.for('stream-error');

// From Readable:
message type Data(chunk) = Symbol.for('stream-data');
assertion type End() = Symbol.for('stream-end'); // if no interest in this, frame torn down at end
assertion type DataReady() = Symbol.for('stream-data-ready');

// To Writable:
message type Push(chunk, ack) = Symbol.for('stream-push');
assertion type Close(ack) = Symbol.for('stream-close');

// From Writable:
assertion type BackPressure(writableId) = Symbol.for('stream-back-pressure'); // readableId implicit
message type Window(seqno, amount) = Symbol.for('stream-credit');

// To Readable:
message type Pushback(chunk) = Symbol.for('stream-pushback');

// Readable output adapter: (TODO: move to separate module?)
message type Line(line) = Symbol.for('stream-line');

export {
  Stream,
  Incoming, Outgoing, Accepted, Rejected,
  Info, Readable, Writable, Duplex,
  Error,
  Data, End, DataReady,
  Push, Close,
  BackPressure, Window,
  Pushback,
  Line,
};

const READING_STOPPED = 1;
const WRITING_STOPPED = 2;

function _commonStreamBehaviour(s, stopBits) {
  on stop try { s.destroy(); } catch (_err) {}

  field this.stopBits = stopBits;
  stop on (this.stopBits === (READING_STOPPED + WRITING_STOPPED));

  s.on('error', Dataspace.wrapExternal((err) => {
    if (err.errno !== 'ECONNRESET') {
      // TODO: is this really something that should be here?
      // Parameterize error handling for different streams??
      console.error(err);
    }
    currentFacet().stop();
  }));

  s.on('close', Dataspace.wrapExternal((err) => { currentFacet().stop(); }));
}

function _readableStreamBehaviour(id, s) {
  const objectMode = s.objectMode || s.readableObjectMode || false;

  field this.endMonitorExists = false;
  during Observe(Stream(id, End())) {
    on start this.endMonitorExists = true;
    on stop this.endMonitorExists = false;
  }

  s.on('end', Dataspace.wrapExternal(() => {
    if (this.endMonitorExists) {
      react {
        assert Stream(id, End());
        stop on (!this.endMonitorExists) {
          this.stopBits |= READING_STOPPED;
        }
      }
    } else {
      this.stopBits |= READING_STOPPED;
    }
  }));

  on message Stream(id, Pushback($chunk)) s.unshift(chunk);

  field this.outboundWindows = Map();
  during Stream(id, BackPressure($writable)) {
    on asserted Stream(writable, Window($seqno, $amount)) {
      // Attend to `seqno` to allow otherwise-noop changes to
      // refresh the outboundWindow size.
      this.outboundWindows = this.outboundWindows.set(writable, amount);
    }
    on retracted Stream(writable, Window(_, _)) {
      this.outboundWindows = this.outboundWindows.remove(writable);
    }
  }

  field this.outboundWindow = null;
  dataflow {
    const min = this.outboundWindows.min();
    this.outboundWindow = (min === void 0) ? null : Math.max(0, min);
  }

  field this.readable = false;
  s.on('readable', Dataspace.wrapExternal(() => { this.readable = true; }));

  assert Stream(id, DataReady()) when (this.readable);

  during Observe(Stream(id, Data(_))) {
    dataflow {
      while (this.readable && (this.outboundWindow === null || this.outboundWindow > 0)) {
        const maxlen = (this.outboundWindow === null)
              ? void 0
              : Math.min(s.readableLength, this.outboundWindow);
        const chunk = s.read(maxlen);
        if (chunk === null) {
          this.readable = false;
        } else {
          const amount = objectMode ? 1 : chunk.length;
          // This is the adjustment that forces us to pay attention to seqno:
          this.outboundWindows = this.outboundWindows.mapEntries(([t, c]) => [t, c - amount]);
          if (this.outboundWindow !== null) this.outboundWindow -= amount;
          send Stream(id, Data(chunk));
        }
      }
    }
  }
}

function _writableStreamBehaviour(id, s) {
  const objectMode = s.objectMode || s.writableObjectMode || false;

  const refreshWindow = () => {
    this.seqno++;
    return Math.max(0, s.writableHighWaterMark - s.writableLength);
  }
  field this.seqno = 0;
  field this.inboundWindow = refreshWindow();
  during Observe(Stream(id, Window(_, _))) {
    assert Stream(id, Window(this.seqno, this.inboundWindow));
  }

  s.on('drain', Dataspace.wrapExternal(() => { this.inboundWindow = refreshWindow(); }));

  const callbackFor = (k) => (k === null ? void 0 : Dataspace.wrapExternal(() => { send k; }));

  on message Stream(id, Push($chunk, $ack)) {
    s.write(objectMode ? chunk : Bytes.toIO(chunk), callbackFor(ack));
    this.inboundWindow = refreshWindow();
  }

  on message Stream(id, Close($ack)) {
    s.end(callbackFor(ack));
    this.inboundWindow = refreshWindow();
  }
}

export function readableStreamBehaviour(id, s) {
  (function () {
    assert Stream(id, Info(Symbol.for("Readable"), s));

    assert Stream(id, Readable());
    stop on retracted Observe(Stream(id, Readable()));

    _commonStreamBehaviour.call(this, s, WRITING_STOPPED);
    _readableStreamBehaviour.call(this, id, s);
  }).call(currentFacet().fields);
}

export function writableStreamBehaviour(id, s) {
  (function () {
    assert Stream(id, Info(Symbol.for("Writable"), s));

    assert Stream(id, Writable());
    stop on retracted Observe(Stream(id, Writable()));

    _commonStreamBehaviour.call(this, s, READING_STOPPED);
    _writableStreamBehaviour.call(this, id, s);
  }).call(currentFacet().fields);
}

export function duplexStreamBehaviour(id, s) {
  (function () {
    assert Stream(id, Info(Symbol.for("Duplex"), s));

    assert Stream(id, Duplex());
    stop on retracted Observe(Stream(id, Duplex()));

    _commonStreamBehaviour.call(this, s, 0);
    _readableStreamBehaviour.call(this, id, s);
    _writableStreamBehaviour.call(this, id, s);
  }).call(currentFacet().fields);
}

spawn named 'driver/stream-line' {
  during Observe(Stream($id, Line(_))) spawn named ['LineReader', id] {
    field this.buffer = Bytes();
    on message Stream(id, Data($data)) this.buffer = Bytes.concat([this.buffer, data]);
    dataflow {
      const pos = this.buffer.indexOf(10);
      if (pos !== -1) {
        const line = this.buffer.slice(0, pos);
        this.buffer = this.buffer.slice(pos + 1);
        send Stream(id, Line(line));
      }
    }
  }
}

export function spawnConnection(id, spec, s) {
  spawn named ['Incoming', id, spec] {
    assert Stream(id, Incoming(spec));
    stop on retracted Observe(Stream(_, Incoming(spec))) s.destroy();
    stop on message Stream(id, Rejected($err)) s.destroy(err);
    stop on asserted Observe(Stream(id, Duplex())) react duplexStreamBehaviour(id, s);
    stop on message Stream(id, Accepted()) react duplexStreamBehaviour(id, s);
  }
}
