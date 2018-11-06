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

const Struct = require('./struct.js');
const Skeleton = require('./skeleton.js');
const RandomID = require('./randomid.js');
const Dataspace = require('./dataspace.js');
const Ground = require('./ground.js');
const Assertions = require('./assertions.js');

module.exports.Immutable = require('immutable');
// ^ for use by import machinery in syntactic extensions

module.exports.Bag = require("./bag.js");
module.exports.Struct = Struct;
module.exports.Skeleton = Skeleton;
module.exports.RandomID = RandomID;
module.exports.__ = Struct.__;
module.exports._$ = Skeleton._$;

module.exports._Dataspace = Dataspace;
module.exports.Dataspace = Dataspace.Dataspace;
module.exports.currentFacet = Dataspace.Dataspace.currentFacet;
module.exports.Ground = Ground;

module.exports._Assertions = Assertions;
module.exports.Observe = Assertions.Observe;
module.exports.Seal = Assertions.Seal;
module.exports.Inbound = Assertions.Inbound;
module.exports.Outbound = Assertions.Outbound;
module.exports.Instance = Assertions.Instance;

module.exports.bootModule = Ground.bootModule;

// These aren't so much "Universal" as they are "VM-wide-unique".
let uuidIndex = 0;
let uuidInstance = RandomID.randomId(8);
module.exports.genUuid = function (prefix) {
  return (prefix || '__@syndicate') + '_' + uuidInstance + '_' + uuidIndex++;
};
