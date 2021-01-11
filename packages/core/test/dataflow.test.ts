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
  assert(Immutable.is(a, Immutable.Set(bArray)));
}

function checkDamagedNodes(g, expectedObjects) {
  expectSetsEqual(g.damagedNodes, expectedObjects);
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
      assert.strictEqual(g.damagedNodes.size, 1);

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
        assert.strictEqual(c.value, 123);
        assert.strictEqual(d.value, 246);
      });
      it('should lead initially to damaged everything', () => {
        assert.strictEqual(g.damagedNodes.size, 2);
      });
      it('should repair idempotently after initialization', () => {
        g.repairDamage(function (c) { c.refresh(); });
        assert.strictEqual(c.value, 123);
        assert.strictEqual(d.value, 246);
      });
      it('should be inconsistent after modification but before repair', () => {
        c.value = 124;
        assert.strictEqual(c.value, 124);
        assert.strictEqual(d.value, 246);
      });
      it('should repair itself properly', () => {
        g.repairDamage(function (c) { c.refresh(); });
        assert.strictEqual(c.value, 124);
        assert.strictEqual(d.value, 248);
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
        assert.deepStrictEqual(
          [xs.value.toJS(), sum.value, len.value, avg.value, scale.value, ans.value],
          vs);
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
      assert.strictEqual(ss.root.p, 123);
      assert.strictEqual(ss.mid.p, 123);
      assert.strictEqual(ss.outer.p, 123);
      assert('p' in ss.root);
      assert('p' in ss.mid);
      assert('p' in ss.outer);
    });

    it('should make changes at root visible at leaves', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.root, 'p', 123);
      assert.strictEqual(ss.outer.p, 123);
      ss.root.p = 234;
      assert.strictEqual(ss.root.p, 234);
      assert.strictEqual(ss.outer.p, 234);
    });

    it('should make changes at leaves visible at root', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.root, 'p', 123);
      assert.strictEqual(ss.outer.p, 123);
      ss.outer.p = 234;
      assert.strictEqual(ss.root.p, 234);
      assert.strictEqual(ss.outer.p, 234);
    });

    it('should hide definitions at leaves from roots', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.outer, 'p', 123);
      assert.strictEqual(ss.outer.p, 123);
      assert.strictEqual(ss.mid.p, undefined);
      assert.strictEqual(ss.root.p, undefined);
      assert(!('p' in ss.root));
      assert(!('p' in ss.mid));
      assert('p' in ss.outer);
    });

    it('should hide middle definitions from roots but show to leaves', () => {
      var ss = buildScopes();
      g.defineObservableProperty(ss.mid, 'p', 123);
      assert.strictEqual(ss.outer.p, 123);
      assert.strictEqual(ss.mid.p, 123);
      assert.strictEqual(ss.root.p, undefined);
      assert(!('p' in ss.root));
      assert('p' in ss.mid);
      assert('p' in ss.outer);
    });
  });

});
