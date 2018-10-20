"use strict";

const expect = require('chai').expect;
const Immutable = require('immutable');
const Bag = require('../src/bag.js');

describe('immutable bag', function () {
  it('should be initializable from a set', function () {
    var b = Bag.fromSet(Immutable.Set(['a', 'b', 'c']));
    expect(b.count()).to.equal(3);
    expect(Bag.get(b, 'a')).to.equal(1);
    expect(Bag.get(b, 'z')).to.equal(0);
  });

  it('should be initializable from an array', function () {
    var b = Bag.fromSet(['a', 'b', 'c', 'a']);
    expect(b.count()).to.equal(3);
    expect(Bag.get(b, 'a')).to.equal(1);
    expect(Bag.get(b, 'z')).to.equal(0);
  });

  it('should be immutable', function () {
    var b = Bag.Bag();
    Bag.change(b, 'a', 1);
    Bag.change(b, 'a', 1);
    expect(b).to.equal(Bag.Bag());
  });

  it('should count up', function () {
    var b = Bag.Bag();
    var change1, change2;
    ({bag: b, net: change1} = Bag.change(b, 'a', 1));
    ({bag: b, net: change2} = Bag.change(b, 'a', 1));
    expect(change1).to.equal(Bag.ABSENT_TO_PRESENT);
    expect(change2).to.equal(Bag.PRESENT_TO_PRESENT);
    expect(Bag.get(b, 'a')).to.equal(2);
    expect(Bag.get(b, 'z')).to.equal(0);
  });

  it('should count down', function () {
    var b = Bag.fromSet(['a']);
    var c1, c2, c3, c4;
    ({bag: b, net: c1} = Bag.change(b, 'a', 1));
    ({bag: b, net: c2} = Bag.change(b, 'a', -1));
    expect(b.count()).to.equal(1);
    expect(c1).to.equal(Bag.PRESENT_TO_PRESENT);
    expect(c2).to.equal(Bag.PRESENT_TO_PRESENT);
    ({bag: b, net: c3} = Bag.change(b, 'a', -1));
    expect(b.count()).to.equal(0);
    expect(c3).to.equal(Bag.PRESENT_TO_ABSENT);
    expect(Bag.get(b, 'a')).to.equal(0);
    expect(Bag.get(b, 'z')).to.equal(0);
    ({bag: b, net: c4} = Bag.change(b, 'a', -1));
    expect(b.count()).to.equal(1);
    expect(c4).to.equal(Bag.ABSENT_TO_PRESENT);
    expect(Bag.get(b, 'a')).to.equal(-1);
  });

  it('should be clamped', function() {
    var b = Bag.fromSet(['a']);
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    ({bag: b} = Bag.change(b, 'a', -1, true));
    expect(b.count()).to.equal(0);
    expect(Bag.get(b, 'a')).to.equal(0);
  });
});

describe('mutable bag', function () {
  it('should be initializable from a set', function () {
    var b = new Bag.MutableBag(Immutable.Set(['a', 'b', 'c']));
    expect(b.count()).to.equal(3);
    expect(b.get('a')).to.equal(1);
    expect(b.get('z')).to.equal(0);
  });

  it('should be initializable from an array', function () {
    var b = new Bag.MutableBag(['a', 'b', 'c', 'a']);
    expect(b.count()).to.equal(3);
    expect(b.get('a')).to.equal(1);
    expect(b.get('z')).to.equal(0);
  });

  it('should be mutable', function () {
    var b = new Bag.MutableBag();
    b.change('a', 1);
    b.change('a', 1);
    expect(b.get('a')).to.equal(2);
    expect(b.get('z')).to.equal(0);
  });

  it('should count up', function () {
    var b = new Bag.MutableBag();
    expect(b.change('a', 1)).to.equal(Bag.ABSENT_TO_PRESENT);
    expect(b.change('a', 1)).to.equal(Bag.PRESENT_TO_PRESENT);
    expect(b.get('a')).to.equal(2);
    expect(b.get('z')).to.equal(0);
  });

  it('should count down', function () {
    var b = new Bag.MutableBag(['a']);
    expect(b.change('a', 1)).to.equal(Bag.PRESENT_TO_PRESENT);
    expect(b.change('a', -1)).to.equal(Bag.PRESENT_TO_PRESENT);
    expect(b.count()).to.equal(1);
    expect(b.change('a', -1)).to.equal(Bag.PRESENT_TO_ABSENT);
    expect(b.count()).to.equal(0);
    expect(b.get('a')).to.equal(0);
    expect(b.get('z')).to.equal(0);
    expect(b.change('a', -1)).to.equal(Bag.ABSENT_TO_PRESENT);
    expect(b.count()).to.equal(1);
    expect(b.get('a')).to.equal(-1);
  });
});
