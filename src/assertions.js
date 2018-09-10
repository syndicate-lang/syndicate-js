"use strict";

var Struct = require('./struct.js');

function Seal(contents) {
  this.contents = contents;
}

module.exports.Observe = Struct.makeConstructor('Observe', ['specification']);
module.exports.Seal = Seal;
module.exports.Inbound = Struct.makeConstructor('Inbound', ['assertion']);
module.exports.Outbound = Struct.makeConstructor('Outbound', ['assertion']);
