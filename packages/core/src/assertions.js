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
  this.contents = contents;
}

module.exports.Observe = Struct.makeConstructor('Observe', ['specification']);
module.exports.Seal = Seal;
module.exports.Inbound = Struct.makeConstructor('Inbound', ['assertion']);
module.exports.Outbound = Struct.makeConstructor('Outbound', ['assertion']);
module.exports.Instance = Struct.makeConstructor('Instance', ['uniqueId']);
