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

const assert = require('assert');
const Immutable = require('immutable');
const Bag = require('../src/bag.js');

describe('immutable bag', function () {
  it('should be initializable from a set', function () {
    var b = Bag.fromSet(Immutable.Set(['a', 'b', 'c']));
    assert.strictEqual(b.count(), 3);
    assert.strictEqual(Bag.get(b, 'a'), 1);
    assert.strictEqual(Bag.get(b, 'z'), 0);
  });

  it('should be initializable from an array', function () {
    var b = Bag.fromSet(['a', 'b', 'c', 'a']);
    assert.strictEqual(b.count(), 3);
    assert.strictEqual(Bag.get(b, 'a'), 1);
    assert.strictEqual(Bag.get(b, 'z'), 0);
  });

  it('should be immutable', function () {
    var b = Bag.Bag();
    Bag.change(b, 'a', 1);
    Bag.change(b, 'a', 1);
    assert(Immutable.is(b, Bag.Bag()));
  });

  it('should count up', function () {
    var b = Bag.Bag();
    var change1, change2;
    ({bag: b, net: change1} = Bag.change(b, 'a', 1));
    ({bag: b, net: change2} = Bag.change(b, 'a', 1));
    assert.strictEqual(change1, Bag.ABSENT_TO_PRESENT);
    assert.strictEqual(change2, Bag.PRESENT_TO_PRESENT);
    assert.strictEqual(Bag.get(b, 'a'), 2);
    assert.strictEqual(Bag.get(b, 'z'), 0);
  });

  it('should count down', function () {
    var b = Bag.fromSet(['a']);
    var c1, c2, c3, c4;
    ({bag: b, net: c1} = Bag.change(b, 'a', 1));
    ({bag: b, net: c2} = Bag.change(b, 'a', -1));
    assert.strictEqual(b.count(), 1);
    assert.strictEqual(c1, Bag.PRESENT_TO_PRESENT);
    assert.strictEqual(c2, Bag.PRESENT_TO_PRESENT);
    ({bag: b, net: c3} = Bag.change(b, 'a', -1));
    assert.strictEqual(b.count(), 0);
    assert.strictEqual(c3, Bag.PRESENT_TO_ABSENT);
    assert.strictEqual(Bag.get(b, 'a'), 0);
    assert.strictEqual(Bag.get(b, 'z'), 0);
    ({bag: b, net: c4} = Bag.change(b, 'a', -1));
    assert.strictEqual(b.count(), 1);
    assert.strictEqual(c4, Bag.ABSENT_TO_PRESENT);
    assert.strictEqual(Bag.get(b, 'a'), -1);
  });

  it('should be clamped', function() {
    var b = Bag.fromSet(['a']);
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    assert.strictEqual(b.count(), 0);
    assert.strictEqual(Bag.get(b, 'a'), 0);
  });
});

describe('mutable bag', function () {
  it('should be initializable from a set', function () {
    var b = new Bag.MutableBag(Immutable.Set(['a', 'b', 'c']));
    assert.strictEqual(b.count(), 3);
    assert.strictEqual(b.get('a'), 1);
    assert.strictEqual(b.get('z'), 0);
  });

  it('should be initializable from an array', function () {
    var b = new Bag.MutableBag(['a', 'b', 'c', 'a']);
    assert.strictEqual(b.count(), 3);
    assert.strictEqual(b.get('a'), 1);
    assert.strictEqual(b.get('z'), 0);
  });

  it('should be mutable', function () {
    var b = new Bag.MutableBag();
    b.change('a', 1);
    b.change('a', 1);
    assert.strictEqual(b.get('a'), 2);
    assert.strictEqual(b.get('z'), 0);
  });

  it('should count up', function () {
    var b = new Bag.MutableBag();
    assert.strictEqual(b.change('a', 1), Bag.ABSENT_TO_PRESENT);
    assert.strictEqual(b.change('a', 1), Bag.PRESENT_TO_PRESENT);
    assert.strictEqual(b.get('a'), 2);
    assert.strictEqual(b.get('z'), 0);
  });

  it('should count down', function () {
    var b = new Bag.MutableBag(['a']);
    assert.strictEqual(b.change('a', 1), Bag.PRESENT_TO_PRESENT);
    assert.strictEqual(b.change('a', -1), Bag.PRESENT_TO_PRESENT);
    assert.strictEqual(b.count(), 1);
    assert.strictEqual(b.change('a', -1), Bag.PRESENT_TO_ABSENT);
    assert.strictEqual(b.count(), 0);
    assert.strictEqual(b.get('a'), 0);
    assert.strictEqual(b.get('z'), 0);
    assert.strictEqual(b.change('a', -1), Bag.ABSENT_TO_PRESENT);
    assert.strictEqual(b.count(), 1);
    assert.strictEqual(b.get('a'), -1);
  });
});
