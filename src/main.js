"use strict";

const Struct = require('./struct.js');
const Skeleton = require('./skeleton.js');
const Dataspace = require('./dataspace.js');
const Assertions = require('./assertions.js');

module.exports.Immutable = require('immutable');
// ^ for use by import machinery in syntactic extensions

module.exports.Bag = require("./bag.js");
module.exports.Struct = Struct;
module.exports.Skeleton = Skeleton;
module.exports.__ = Struct.__;
module.exports._$ = Skeleton._$;

module.exports._Dataspace = Dataspace;
module.exports.Dataspace = Dataspace.Dataspace;

module.exports._Assertions = Assertions;
module.exports.Observe = Assertions.Observe;
module.exports.Seal = Assertions.Seal;
module.exports.Inbound = Assertions.Inbound;
module.exports.Outbound = Assertions.Outbound;
