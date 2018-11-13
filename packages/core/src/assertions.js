"use strict";
//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
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

var Struct = require('./struct.js');

function Seal(contents) {
  if (this === void 0) {
    return new Seal(contents);
  }

  this.contents = contents;
}

Seal.prototype.toJSON = function () {
  // This definition is useless for actual transport, of course, but
  // useful for debugging, inasmuch as it seals off the contents from
  // the view of the JSON renderer, which has trouble with e.g. cyclic
  // data.
  return { '@seal': 0 };
};

module.exports.Discard = Struct.makeConstructor('discard', []);
module.exports.Capture = Struct.makeConstructor('capture', ['specification']);
module.exports.Observe = Struct.makeConstructor('observe', ['specification']);
module.exports.Seal = Seal;
module.exports.Inbound = Struct.makeConstructor('inbound', ['assertion']);
module.exports.Outbound = Struct.makeConstructor('outbound', ['assertion']);
module.exports.Instance = Struct.makeConstructor('instance', ['uniqueId']);
