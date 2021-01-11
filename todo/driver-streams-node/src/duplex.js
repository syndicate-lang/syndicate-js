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

// Just enough functionality to make a pair of Readable/Writable
// streams appear to be a Duplex stream from the POV of the Syndicate
// driver in this package.

const util = require('util');
const events = require('events');

function Duplex(r, w) {
  this.r = r;
  this.w = w;
}

Duplex.prototype.on = function (evt, cb) {
  switch (evt) {
    case 'readable':
    case 'end':
      this.r.on(evt, cb);
      break;
    case 'drain':
      this.w.on(evt, cb);
      break;
    case 'close':
    case 'error':
      this.r.on(evt, cb);
      this.w.on(evt, cb);
      break;
    default: throw new Error("Duplex: unsupported event: " + evt);
  }
  return this;
};

function proxyProp(name, target) {
  Object.defineProperty(Duplex.prototype, name, {
    configurable: true,
    enumerable: true,
    get: function () { return this[target][name]; }
  });
}

proxyProp('readableLength', 'r');
proxyProp('writableLength', 'w');
proxyProp('writableHighWaterMark', 'w');

Duplex.prototype.read = function (size) {
  return this.r.read(size);
};

Duplex.prototype.write = function (chunk, cb) {
  return this.w.write(chunk, cb);
};

util.inherits(Duplex, events.EventEmitter);

module.exports = Duplex;
