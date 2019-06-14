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

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                'assertions.js',
                                                module)) return;

var { Record } = require('preserves');

function Seal(contents) {
  if (!(this instanceof Seal)) return new Seal(contents);
  this.contents = contents;
}

Seal.prototype.toJSON = function () {
  // This definition is useless for actual transport, of course, but
  // useful for debugging, inasmuch as it seals off the contents from
  // the view of the JSON renderer, which has trouble with e.g. cyclic
  // data.
  return { '@seal': 0 };
};

module.exports.Discard = Record.makeConstructor('discard', []);
module.exports.Discard._instance = module.exports.Discard();

module.exports.Capture = Record.makeConstructor('capture', ['specification']);
module.exports.Observe = Record.makeConstructor('observe', ['specification']);

module.exports.Inbound = Record.makeConstructor('inbound', ['assertion']);
module.exports.Outbound = Record.makeConstructor('outbound', ['assertion']);
module.exports.Instance = Record.makeConstructor('instance', ['uniqueId']);

module.exports.Seal = Seal;
