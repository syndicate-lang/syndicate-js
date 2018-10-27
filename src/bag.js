"use strict";
// Bags and Deltas (which are Bags where item-counts can be negative).

const Immutable = require("immutable");

const PRESENT_TO_ABSENT = -1;
const ABSENT_TO_ABSENT = 0;
const ABSENT_TO_PRESENT = 1;
const PRESENT_TO_PRESENT = 2;

///////////////////////////////////////////////////////////////////////////

function MutableBag(s) {
  this._items = s ? fromSet(s) : Immutable.Map();
}

MutableBag.prototype.change = function (key, delta) {
  var net;
  ({bag: this._items, net: net} = change(this._items, key, delta));
  return net;
};

MutableBag.prototype.get = function (key) {
  return get(this._items, key);
};

MutableBag.prototype.clear = function () {
  this._items = Immutable.Map();
};

MutableBag.prototype.includes = function (key) {
  return includes(this._items, key);
};

MutableBag.prototype.isEmpty = function () {
  return this._items.isEmpty();
};

MutableBag.prototype.count = function () {
  return this._items.count();
};

MutableBag.prototype.keys = function () {
  return this._items.keys();
};

MutableBag.prototype.entries = function () {
  return this._items.entries();
};

MutableBag.prototype.snapshot = function () {
  return this._items;
};

///////////////////////////////////////////////////////////////////////////

const Bag = Immutable.Map;

function fromSet(s) {
  return Bag().withMutations(function (b) {
    for (let v of Immutable.Set(s)) {
      b = b.set(v, 1);
    }
  });
}

function change(bag, key, delta, clamp) {
  let oldCount = get(bag, key);
  let newCount = oldCount + delta;
  if (clamp) {
    newCount = Math.max(0, newCount);
  }
  if (newCount === 0) {
    return {
      bag: bag.remove(key),
      net: (oldCount === 0) ? ABSENT_TO_ABSENT : PRESENT_TO_ABSENT
    };
  } else {
    return {
      bag: bag.set(key, newCount),
      net: (oldCount === 0) ? ABSENT_TO_PRESENT : PRESENT_TO_PRESENT
    };
  }
}

function get(bag, key) {
  return bag.get(key, 0);
}

function includes(bag, key) {
  return get(bag, key) > 0;
}

///////////////////////////////////////////////////////////////////////////

module.exports.PRESENT_TO_ABSENT = PRESENT_TO_ABSENT;
module.exports.ABSENT_TO_ABSENT = ABSENT_TO_ABSENT;
module.exports.ABSENT_TO_PRESENT = ABSENT_TO_PRESENT;
module.exports.PRESENT_TO_PRESENT = PRESENT_TO_PRESENT;
module.exports.MutableBag = MutableBag;
module.exports.Bag = Bag;
module.exports.fromSet = fromSet;
module.exports.change = change;
module.exports.get = get;
module.exports.includes = includes;
