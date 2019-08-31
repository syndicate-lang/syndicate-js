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

const Syndicate = require('../src/index.js');
const { Seal, Skeleton, Capture, Discard, Record, Observe } = Syndicate;

const __ = Discard();
const _$ = Capture(Discard());

const Event = Record.makeConstructor('Event', ['label', 'type', 'values']);

function eventCallback(traceHolder, label) {
  return (e, vs) => { traceHolder.push(Event(label, e, vs)) };
}

function skeletonTrace(f) {
  let traceHolder = {
    trace: Immutable.List(),
    push: function (e) { this.trace = this.trace.push(e); }
  };
  let i = new Skeleton.Index();
  f(i, traceHolder);
  return traceHolder.trace;
}

function _analyzeAssertion(a) {
  return Skeleton.analyzeAssertion(Immutable.fromJS(a));
}

function assertImmutableEqual(a, b) {
  assert(Immutable.is(Immutable.fromJS(a), Immutable.fromJS(b)));
}

describe('skeleton', () => {

  const A = Record.makeConstructor('A', ['x', 'y']);
  const B = Record.makeConstructor('B', ['v']);
  const C = Record.makeConstructor('C', ['v']);

  describe('pattern analysis', () => {
    it('should handle leaf captures', () => {
      assertImmutableEqual(_analyzeAssertion(A(B(_$), _$)),
                           {assertion: Observe(A(B(_$), _$)),
                            skeleton: [A.constructorInfo, [B.constructorInfo, null], null],
                            constPaths: Immutable.fromJS([]),
                            constVals: Immutable.fromJS([]),
                            capturePaths: Immutable.fromJS([[0, 0], [1]])});
    });
    it('should handle atomic constants', () => {
      assertImmutableEqual(_analyzeAssertion(A(B("x"), _$)),
                           {assertion: Observe(A(B("x"), _$)),
                            skeleton: [A.constructorInfo, [B.constructorInfo, null], null],
                            constPaths: Immutable.fromJS([[0, 0]]),
                            constVals: Immutable.fromJS(["x"]),
                            capturePaths: Immutable.fromJS([[1]])});
    });
    it('should handle complex constants (1)', () => {
      // Marker: (***)
      // Really this comes about when compiled code has no static
      // visibility into the value of a constant, and that constant
      // will end up being complex at runtime. We can't properly test
      // that situation without the static analysis half of the code.
      // TODO later.
      const complexPlaceholder = new Object();
      const analysis = _analyzeAssertion(A(complexPlaceholder, C(_$)));
      const expected = {
        assertion: Observe(A(complexPlaceholder, C(_$))),
        skeleton: [A.constructorInfo, null, [C.constructorInfo, null]],
        constPaths: Immutable.fromJS([[0]]),
        constVals: Immutable.fromJS([complexPlaceholder]),
        capturePaths: Immutable.fromJS([[1, 0]]),
      };
      assertImmutableEqual(analysis, expected);
    });
    it('should handle complex constants (2)', () => {
      // Marker: (***)
      // Really this comes about when compiled code has no static
      // visibility into the value of a constant, and that constant
      // will end up being complex at runtime. We can't properly test
      // that situation without the static analysis half of the code.
      // TODO later.
      assertImmutableEqual(_analyzeAssertion(A(B(B("y")), Capture(C(__)))),
                           {assertion: Observe(A(B(B("y")), Capture(C(__)))),
                            skeleton: [A.constructorInfo,
                                       [B.constructorInfo, [B.constructorInfo, null]],
                                       [C.constructorInfo, null]],
                            constPaths: Immutable.fromJS([[0, 0, 0]]),
                            constVals: Immutable.fromJS(["y"]),
                            capturePaths: Immutable.fromJS([[1]])});
    });
    it('should handle list patterns with discards', () => {
      assertImmutableEqual(_analyzeAssertion([__, __]),
                           {assertion: Observe([__, __]),
                            skeleton: [2, null, null],
                            constPaths: Immutable.fromJS([]),
                            constVals: Immutable.fromJS([]),
                            capturePaths: Immutable.fromJS([])});
    });
    it('should handle list patterns with constants and captures', () => {
      assertImmutableEqual(_analyzeAssertion(["hi", _$, _$]),
                           {assertion: Observe(["hi", _$, _$]),
                            skeleton: [3, null, null, null],
                            constPaths: Immutable.fromJS([[0]]),
                            constVals: Immutable.fromJS(["hi"]),
                            capturePaths: Immutable.fromJS([[1],[2]])});
    });
  });

  describe('nested structs', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(_analyzeAssertion(A(B(_$), _$)), eventCallback(traceHolder, "AB"));
      i.addHandler(_analyzeAssertion(A(B("x"), _$)), eventCallback(traceHolder, "ABx"));
      let complexConstantPattern1 =
          {skeleton: [A.constructorInfo, null, [C.constructorInfo, null]],
           constPaths: Immutable.fromJS([[0]]),
           constVals: Immutable.fromJS([B("y")]),
           capturePaths: Immutable.fromJS([[1, 0]])};
      // ^ See comment in 'should handle complex constants (1)' test above (marked (***)).
      i.addHandler(complexConstantPattern1, eventCallback(traceHolder, "AByC"));
      let complexConstantPattern2 = {skeleton: [A.constructorInfo,
                                                [B.constructorInfo, null],
                                                [C.constructorInfo, null]],
                                     constPaths: Immutable.fromJS([[0, 0]]),
                                     constVals: Immutable.fromJS([B("y")]),
                                     capturePaths: Immutable.fromJS([[1]])};
      i.addHandler(complexConstantPattern2, eventCallback(traceHolder, "ABByC"));

      i.addAssertion(Immutable.fromJS(A(B("x"),C(1))));
      i.addAssertion(Immutable.fromJS(A(B("y"),C(2))));
      i.addAssertion(Immutable.fromJS(A(B(B("y")),C(2))));
      i.addAssertion(Immutable.fromJS(A(B("z"),C(3))));
    });

    // trace.forEach((e) => { console.log(e) });

    it('should work', () => {
      assertImmutableEqual(trace,
                           [Event("AB", Skeleton.EVENT_ADDED, ["x", C(1)]),
                            Event("ABx", Skeleton.EVENT_ADDED, [C(1)]),
                            Event("AB", Skeleton.EVENT_ADDED, ["y", C(2)]),
                            Event("AByC", Skeleton.EVENT_ADDED, [2]),
                            Event("AB", Skeleton.EVENT_ADDED, [B("y"), C(2)]),
                            Event("ABByC", Skeleton.EVENT_ADDED, [C(2)]),
                            Event("AB", Skeleton.EVENT_ADDED, ["z", C(3)])]);
    });
  });

  describe('simple detail-erasing trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(_analyzeAssertion([__, __]), eventCallback(traceHolder, "2-EVENT"));

      i.addAssertion(Immutable.fromJS(["hi", 123]));
      i.addAssertion(Immutable.fromJS(["hi", 234]));
      i.removeAssertion(Immutable.fromJS(["hi", 123]));
      i.removeAssertion(Immutable.fromJS(["hi", 234]));
    });

    it('should have one add and one remove', () => {
      assertImmutableEqual(trace,
                           [Event("2-EVENT", Skeleton.EVENT_ADDED, []),
                            Event("2-EVENT", Skeleton.EVENT_REMOVED, [])]);
    });
  });

  describe('handler added after assertion (1)', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.addHandler(_analyzeAssertion(["hi", _$, _$]), eventCallback(traceHolder, "X"));
      i.removeAssertion(Immutable.fromJS(["hi", 123, 234]));
    });

    it('should get two events', () => {
      assertImmutableEqual(trace,
                           [Event("X", Skeleton.EVENT_ADDED, [123, 234]),
                            Event("X", Skeleton.EVENT_REMOVED, [123, 234])]);
    });
  });

  describe('handler added after assertion (2)', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.addHandler(_analyzeAssertion(_$), eventCallback(traceHolder, "X"));
      i.removeAssertion(Immutable.fromJS(["hi", 123, 234]));
    });

    it('should get two events', () => {
      assertImmutableEqual(trace,
                           [Event("X", Skeleton.EVENT_ADDED, [["hi", 123, 234]]),
                            Event("X", Skeleton.EVENT_REMOVED, [["hi", 123, 234]])]);
    });
  });

  describe('handler removed before assertion removed', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(Immutable.fromJS(["hi", 123, 234]));
      let h = _analyzeAssertion(["hi", _$, _$]);
      h.callback = eventCallback(traceHolder, "X")
      i.addHandler(h, h.callback);
      i.removeHandler(h, h.callback);
      i.removeAssertion(Immutable.fromJS(["hi", 123, 234]));
    });

    it('should get one event', () => {
      assertImmutableEqual(trace,
                           [Event("X", Skeleton.EVENT_ADDED, [123, 234])]);
    });
  });

  describe('simple list assertions trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(_analyzeAssertion(["hi", _$, _$]), eventCallback(traceHolder, "3-EVENT"));
      i.addHandler(_analyzeAssertion([__, __]), eventCallback(traceHolder, "2-EVENT"));

      i.addAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.addAssertion(Immutable.fromJS(["hi", 999, 999]));
      i.addAssertion(Immutable.fromJS(["hi", 123]));
      i.addAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.sendMessage(Immutable.fromJS(["hi", 303]));
      i.sendMessage(Immutable.fromJS(["hi", 303, 404]));
      i.sendMessage(Immutable.fromJS(["hi", 303, 404, 808]));
      i.removeAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.removeAssertion(Immutable.fromJS(["hi", 999, 999]));
      i.removeAssertion(Immutable.fromJS(["hi", 123, 234]));
      i.addAssertion(Immutable.fromJS(["hi", 123]));
      i.addAssertion(Immutable.fromJS(["hi", 234]));
      i.removeAssertion(Immutable.fromJS(["hi", 123]));
      i.removeAssertion(Immutable.fromJS(["hi", 123]));
      i.removeAssertion(Immutable.fromJS(["hi", 234]));
    });

    it('should have 8 entries', () => {
      assert.strictEqual(trace.size, 8);
    });
    it('should have a correct 3-EVENT subtrace', () => {
      assertImmutableEqual(trace.filter((e) => { return Event._label(e) === "3-EVENT"; }),
                           [Event("3-EVENT", Skeleton.EVENT_ADDED, [123, 234]),
                            Event("3-EVENT", Skeleton.EVENT_ADDED, [999, 999]),
                            Event("3-EVENT", Skeleton.EVENT_MESSAGE, [303, 404]),
                            Event("3-EVENT", Skeleton.EVENT_REMOVED, [999, 999]),
                            Event("3-EVENT", Skeleton.EVENT_REMOVED, [123, 234])]);
    });
    it('should have a correct 2-EVENT subtrace', () => {
      assertImmutableEqual(trace.filter((e) => { return Event._label(e) === "2-EVENT"; }),
                           [Event("2-EVENT", Skeleton.EVENT_ADDED, []),
                            Event("2-EVENT", Skeleton.EVENT_MESSAGE, []),
                            Event("2-EVENT", Skeleton.EVENT_REMOVED, [])]);
    });
  });

  function expectMatch(a, b, r) {
    assert(Immutable.is(Skeleton.match(Immutable.fromJS(a), Immutable.fromJS(b)), r));
  }

  describe('matching a single pattern against a value', () => {
    it('should accept matching simple records', () => {
      expectMatch(A(1, 2), A(1, 2), Immutable.List());
    });
    it('should capture from matching simple records', () => {
      expectMatch(A(1, _$), A(1, 2), Immutable.List([2]));
    });
    it('should reject mismatching simple records', () => {
      expectMatch(A(1, 2), A(1, "hi"), false);
    });
    it('should accept matching simple lists', () => {
      expectMatch([1, 2, 3], [1, 2, 3], Immutable.List());
    });
    it('should accept matching nested lists', () => {
      expectMatch([1, [2, 4], 3], [1, [2, 4], 3], Immutable.List());
    });
    it('should capture matches from simple lists', () => {
      expectMatch([1, Capture(2), 3], [1, 2, 3], Immutable.List([2]));
    });
    it('should capture discards from simple lists', () => {
      expectMatch([1, Capture(__), 3], [1, 2, 3], Immutable.List([2]));
    });
    it('should capture discards from nested lists', () => {
      expectMatch([1, Capture(__), 3], [1, [2, 4], 3], Immutable.fromJS([[2, 4]]));
    });
    it('should capture nested discards from nested lists', () => {
      expectMatch([1, Capture([__, 4]), 3], [1, [2, 4], 3], Immutable.fromJS([[2, 4]]));
    });
    it('should reject nested mismatches from nested lists', () => {
      expectMatch([1, Capture([__, 5]), 3], [1, [2, 4], 3], false);
    });
    it('should reject mismatching captures from simple lists', () => {
      expectMatch([1, Capture(9), 3], [1, 2, 3], false);
    });
    it('should reject simple lists varying in arity', () => {
      expectMatch([1, 2, 3, 4], [1, 2, 3], false);
    });
    it('should reject simple lists varying in order', () => {
      expectMatch([1, 3, 2], [1, 2, 3], false);
    });
  });
});

describe('path comparison', () => {
  const { pathCmp } = require('../src/skeleton.js').__for_testing;
  const L = (...args) => Immutable.List(args);
  function c(a, b, expected) {
    assert.strictEqual(pathCmp(a, b), expected);
  }

  it('should identify empty paths', () => c(L(), L(), 0));
  it('should identify equal nonempty paths (1)', () => c(L(1, 1), L(1, 1), 0));
  it('should identify equal nonempty paths (2)', () => c(L(2, 2), L(2, 2), 0));
  it('should check upper end first (1)', () => c(L(2, 1), L(1, 1), +1));
  it('should check upper end first (2)', () => c(L(1, 1), L(2, 1), -1));
  it('should check upper end first (3)', () => c(L(2, 1), L(1, 2), +1));
  it('should check upper end first (4)', () => c(L(1, 2), L(2, 1), -1));
  it('should check upper end first (5)', () => c(L(2), L(1, 1), +1));
  it('should check upper end first (6)', () => c(L(1), L(2, 1), -1));
  it('should check upper end first (7)', () => c(L(2), L(1, 2), +1));
  it('should check upper end first (8)', () => c(L(1), L(2, 1), -1));
  it('should check upper end first (9)', () => c(L(2, 1), L(1), +1));
  it('should check upper end first (A)', () => c(L(1, 1), L(2), -1));
  it('should check upper end first (B)', () => c(L(2, 1), L(1), +1));
  it('should check upper end first (C)', () => c(L(1, 2), L(2), -1));
  it('should be lexicographic (1)', () => c(L(1, 2), L(1, 2), 0));
  it('should be lexicographic (2)', () => c(L(1), L(1, 2), -1));
  it('should be lexicographic (3)', () => c(L(1, 2), L(1), +1));
});
