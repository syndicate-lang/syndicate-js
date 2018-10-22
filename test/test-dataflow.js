"use strict";

var expect = require('chai').expect;
var Immutable = require('immutable');

var Dataflow = require('../src/dataflow.js');

function Cell(graph, initialValue, name) {
  this.objectId = graph.defineObservableProperty(this, 'value', initialValue, {
    objectId: name,
    noopGuard: (a, b) => a === b
  });
}

function DerivedCell(graph, name, valueThunk) {
  var c = new Cell(graph, undefined, name);
  c.refresh = function () { c.value = valueThunk(); };
  graph.withSubject(c, function () { c.refresh(); });
  return c;
}

function expectSetsEqual(a, bArray) {
  return expect(Immutable.is(a, Immutable.Set(bArray))).to.equal(true);
}

function checkDamagedNodes(g, expectedObjects) {
  return expectSetsEqual(g.damagedNodes, expectedObjects);
}

describe('dataflow', () => {
  describe('edges, damage and subjects', () => {
    it('should be recorded', () => {
      var g = new Dataflow.Graph();
      var c = new Cell(g, 123);

      g.withSubject('s', () => { c.value; });
      g.withSubject('t', () => { c.value; });
      g.withSubject('s', () => { c.value; });

      c.value = 234;
      expect(g.damagedNodes.size).to.equal(1);

      var subjects = Immutable.Set();
      g.repairDamage(function (subjectId) { subjects = subjects.add(subjectId); });
      expectSetsEqual(subjects, ['s', 't']);
    });
  });

  describe('DerivedCell', () => {
    describe('simple case', () => {
      var g = new Dataflow.Graph();
      var c = DerivedCell(g, 'c', () => 123);
      var d = DerivedCell(g, 'd', () => c.value * 2);
      it('should be properly initialized', () => {
        expect(c.value).to.equal(123);
        expect(d.value).to.equal(246);
      });
      it('should lead initially to damaged everything', () => {
        expect(g.damagedNodes.size).to.equal(2);
      });
      it('should repair idempotently after initialization', () => {
        g.repairDamage(function (c) { c.refresh(); });
        expect(c.value).to.equal(123);
        expect(d.value).to.equal(246);
      });
      it('should be inconsistent after modification but before repair', () => {
        c.value = 124;
        expect(c.value).to.equal(124);
        expect(d.value).to.equal(246);
      });
      it('should repair itself properly', () => {
        g.repairDamage(function (c) { c.refresh(); });
        expect(c.value).to.equal(124);
        expect(d.value).to.equal(248);
      });
    });

    describe('a more complex case', () => {
      var g = new Dataflow.Graph();

      function add(a, b) { return a + b; }
      var xs = new Cell(g, Immutable.List.of(1, 2, 3, 4), 'xs');
      var sum = DerivedCell(g, 'sum', () => xs.value.reduce(add, 0));
      var len = DerivedCell(g, 'len', () => xs.value.size);
      var avg = DerivedCell(g, 'avg', () => {
        if (len.value === 0) return null;
        return sum.value / len.value;
      });
      var scale = new Cell(g, 1, 'scale');
      var ans = DerivedCell(g, 'ans', () => {
        if (scale.value === 0) return null;
        return typeof avg.value === 'number' && avg.value / scale.value;
      });

      function expectValues(vs) {
        g.repairDamage(function (c) { c.refresh(); });
        expect([xs.value.toJS(), sum.value, len.value, avg.value, scale.value, ans.value]).to.eql(vs);
      }

      it('initially', () => {
        expectValues([ [1,2,3,4], 10, 4, 2.5, 1, 2.5 ]);
      });
      it('at scale zero', () => {
        scale.value = 0;
        expectValues([ [1,2,3,4], 10, 4, 2.5, 0, null ]);
      });
      it('with nine and zero', () => {
        xs.value = xs.value.concat([9, 0]);
        expectValues([ [1,2,3,4,9,0], 19, 6, 19/6, 0, null ]);
      });
      it('with five and four', () => {
        xs.value = xs.value.skipLast(2).concat([5, 4]);
        expectValues([ [1,2,3,4,5,4], 19, 6, 19/6, 0, null ]);
      });
      it('at scale one', () => {
        scale.value = 1;
        expectValues([ [1,2,3,4,5,4], 19, 6, 19/6, 1, 19/6 ]);
      });
      it('empty', () => {
        xs.value = Immutable.List();
        expectValues([ [], 0, 0, null, 1, false ]);
      });
      it('four, five, and six', () => {
        xs.value = Immutable.List.of(4, 5, 6);
        expectValues([ [4,5,6], 15, 3, 15/3, 1, 15/3 ]);
      });
    });
  });

  describe('scopes', () => {
    var g = new Dataflow.Graph();

    function buildScopes() {
      var rootScope = {};
      var midScope = Dataflow.Graph.newScope(rootScope);
      var outerScope = Dataflow.Graph.newScope(midScope);
      return {root: rootScope, mid: midScope, outer: outerScope};
    }

    it('should make rootward props visible further out', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.root, 'p', 123);
      expect(ss.root.p).to.equal(123);
      expect(ss.mid.p).to.equal(123);
      expect(ss.outer.p).to.equal(123);
      expect('p' in ss.root).to.equal(true);
      expect('p' in ss.mid).to.equal(true);
      expect('p' in ss.outer).to.equal(true);
    });

    it('should make changes at root visible at leaves', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.root, 'p', 123);
      expect(ss.outer.p).to.equal(123);
      ss.root.p = 234;
      expect(ss.root.p).to.equal(234);
      expect(ss.outer.p).to.equal(234);
    });

    it('should make changes at leaves visible at root', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.root, 'p', 123);
      expect(ss.outer.p).to.equal(123);
      ss.outer.p = 234;
      expect(ss.root.p).to.equal(234);
      expect(ss.outer.p).to.equal(234);
    });

    it('should hide definitions at leaves from roots', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.outer, 'p', 123);
      expect(ss.outer.p).to.equal(123);
      expect(ss.mid.p).to.equal(undefined);
      expect(ss.root.p).to.equal(undefined);
      expect('p' in ss.root).to.equal(false);
      expect('p' in ss.mid).to.equal(false);
      expect('p' in ss.outer).to.equal(true);
    });

    it('should hide middle definitions from roots but show to leaves', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.mid, 'p', 123);
      expect(ss.outer.p).to.equal(123);
      expect(ss.mid.p).to.equal(123);
      expect(ss.root.p).to.equal(undefined);
      expect('p' in ss.root).to.equal(false);
      expect('p' in ss.mid).to.equal(true);
      expect('p' in ss.outer).to.equal(true);
    });
  });

});
