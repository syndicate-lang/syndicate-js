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
                                                'index.js',
                                                module)) return;

const Skeleton = require('./skeleton.js');
const RandomID = require('./randomid.js');
const Dataspace = require('./dataspace.js');
const Ground = require('./ground.js');
const Assertions = require('./assertions.js');
const Relay = require('./relay.js');
const Bag = require('./bag.js');
const Worker = require('./worker.js');

Object.assign(module.exports, require("preserves"));

//---------------------------------------------------------------------------

module.exports.Bag = Bag;
module.exports.Skeleton = Skeleton;
module.exports.RandomID = RandomID;

module.exports._Dataspace = Dataspace;
module.exports.Dataspace = Dataspace.Dataspace;
module.exports.currentFacet = Dataspace.Dataspace.currentFacet;
module.exports.Ground = Ground;

module.exports._Assertions = Assertions;
module.exports.Discard = Assertions.Discard;
module.exports.Capture = Assertions.Capture;
module.exports.Observe = Assertions.Observe;
module.exports.Seal = Assertions.Seal;
module.exports.Inbound = Assertions.Inbound;
module.exports.Outbound = Assertions.Outbound;
module.exports.Instance = Assertions.Instance;

module.exports.$QuitDataspace = Relay.$QuitDataspace;
module.exports.NestedDataspace = Relay.NestedDataspace;
module.exports.inNestedDataspace = Relay.inNestedDataspace;

module.exports.bootModule = Ground.bootModule;
module.exports.spawnWorker = Worker.spawnWorker;

// These aren't so much "Universal" as they are "VM-wide-unique".
let uuidIndex = 0;
let uuidInstance = RandomID.randomId(8);
module.exports.genUuid = function (prefix) {
  return (prefix || '__@syndicate') + '_' + uuidInstance + '_' + uuidIndex++;
};
