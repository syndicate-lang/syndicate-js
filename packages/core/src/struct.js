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

// "Structures": Simple named-tuple-like records.

const Immutable = require("immutable");
const $Special = require('./special.js');

function StructureType(label, arity) {
  this.label = label;
  this.arity = arity;

  var self = this;
  this.ctor = function () {
    return self.instantiate(Array.prototype.slice.call(arguments));
  };
  this.ctor.meta = this;
  this.ctor.isClassOf = function (v) { return self.isClassOf(v); };
}

function makeConstructor(label, fieldNames) {
  return new StructureType(label, fieldNames.length).ctor;
}

StructureType.prototype.equals = function (other) {
  if (!(other instanceof StructureType)) return false;
  return this.arity === other.arity && this.label === other.label;
};

StructureType.prototype.hashCode = function () {
  return Immutable.List([this.label, this.arity]).hashCode();
};

StructureType.prototype.instantiate = function (fields) {
  return new Structure(this, fields);
};

StructureType.prototype.isClassOf = function (v) {
  return v && (v instanceof Structure) && (v.meta.equals(this));
};

function Structure(meta, fields) {
  if (!isStructureType(meta)) {
    throw new Error("Structure: requires structure type");
  }
  if (fields.length !== meta.arity) {
    throw new Error("Structure: cannot instantiate meta "+JSON.stringify(meta.label)+
                    " expecting "+meta.arity+" fields with "+fields.length+" fields");
  }
  fields = fields.slice(0);
  this.meta = meta;
  this.length = meta.arity;
  this.fields = fields;
  for (var i = 0; i < fields.length; i++) {
    this[i] = fields[i] = Immutable.fromJS(fields[i]);
    if (this[i] === void 0) {
      throw new Error("Structure: cannot contain undefined value at field " + i);
    }
  }
}

Structure.prototype.clone = function () {
  return new Structure(this.meta, this.fields);
};

Structure.prototype.get = function (index) {
  return this[index];
};

Structure.prototype.set = function (index, value) {
  var s = this.clone();
  s[index] = s.fields[index] = value;
  return s;
};

Structure.prototype.equals = function (other) {
  if (!other) return false;
  if (!(other instanceof Structure)) return false;
  if (!other.meta.equals(this.meta)) return false;
  for (let i = 0; i < this.length; i++) {
    const a = this[i];
    const b = other[i];
    if (a === b) continue;
    if (!a || typeof a.equals !== 'function') return false;
    if (!a.equals(b)) return false;
  }
  return true;
};

Structure.prototype.hashCode = function () {
  return Immutable.List(this.fields).unshift(this.meta).hashCode();
};

Structure.prototype.toString = function () {
  let b = this.meta.label + "(";
  let needComma = false;
  for (let v of this.fields) {
    if (needComma) b = b + ", ";
    needComma = true;
    b = b + JSON.stringify(v);
  }
  return b + ")";
};

function reviveStructs(j) {
  if (Array.isArray(j)) {
    return j.map(reviveStructs);
  }

  if ((j !== null) && typeof j === 'object') {
    if ((typeof j['@type'] === 'string') && Array.isArray(j['fields'])) {
      return (new StructureType(j['@type'], j['fields'].length)).instantiate(j['fields']);
    } else {
      for (var k in j) {
        if (Object.prototype.hasOwnProperty.call(j, k)) {
          j[k] = reviveStructs(j[k]);
        }
      }
      return j;
    }
  }

  return j;
}

function reviver(k, v) {
  if (k === '') {
    return reviveStructs(v);
  }
  return v;
};

Structure.prototype.toJSON = function () {
  return { '@type': this.meta.label, 'fields': this.fields };
};

function isStructureType(v) {
  return v && (v instanceof StructureType);
}

function isStructure(v) {
  return v && (v instanceof Structure);
}

///////////////////////////////////////////////////////////////////////////

module.exports.StructureType = StructureType;
module.exports.makeConstructor = makeConstructor;
module.exports.Structure = Structure;
module.exports.reviveStructs = reviveStructs;
module.exports.reviver = reviver;
module.exports.isStructureType = isStructureType;
module.exports.isStructure = isStructure;
