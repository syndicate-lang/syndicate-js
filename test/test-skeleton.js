"use strict";

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-immutable'));

const Immutable = require('immutable');

const Syndicate = require('../src/main.js');
const Skeleton = Syndicate.Skeleton;
const Struct = Syndicate.Struct;
const __ = Syndicate.__;
const _$ = Syndicate._$;

const Event = Struct.makeConstructor('Event', ['label', 'type', 'values']);

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

describe('skeleton', () => {

  const A = Struct.makeConstructor('A', ['x', 'y']);
  const B = Struct.makeConstructor('B', ['v']);
  const C = Struct.makeConstructor('C', ['v']);

  describe('pattern analysis', () => {
    it('should handle leaf captures', () => {
      expect(Immutable.fromJS(Skeleton.analyzeAssertion(A(B(_$), _$))))
        .to.equal(Immutable.fromJS({skeleton: [A.meta, [B.meta, null], null],
                                    constPaths: Immutable.fromJS([]),
                                    constVals: Immutable.fromJS([]),
                                    capturePaths: Immutable.fromJS([[0, 0], [1]])}));
    });
    it('should handle atomic constants', () => {
      expect(Immutable.fromJS(Skeleton.analyzeAssertion(A(B("x"), _$))))
        .to.equal(Immutable.fromJS({skeleton: [A.meta, [B.meta, null], null],
                                    constPaths: Immutable.fromJS([[0, 0]]),
                                    constVals: Immutable.fromJS(["x"]),
                                    capturePaths: Immutable.fromJS([[1]])}));
    });
    it('should handle complex constants (1)', () => {
      // Marker: (***)
      // Really this comes about when compiled code has no static
      // visibility into the value of a constant, and that constant
      // will end up being complex at runtime. We can't properly test
      // that situation without the static analysis half of the code.
      // TODO later.
      let complexPlaceholder = new Object();
      expect(Immutable.fromJS(Skeleton.analyzeAssertion(A(complexPlaceholder, C(_$)))))
        .to.equal(Immutable.fromJS({skeleton: [A.meta, null, [C.meta, null]],
                                    constPaths: Immutable.fromJS([[0]]),
                                    constVals: Immutable.fromJS([complexPlaceholder]),
                                    capturePaths: Immutable.fromJS([[1, 0]])}));
    });
    it('should handle complex constants (2)', () => {
      // Marker: (***)
      // Really this comes about when compiled code has no static
      // visibility into the value of a constant, and that constant
      // will end up being complex at runtime. We can't properly test
      // that situation without the static analysis half of the code.
      // TODO later.
      expect(Immutable.fromJS(Skeleton.analyzeAssertion(A(B(B("y")), _$("rhs", C(__))))))
        .to.equal(Immutable.fromJS({skeleton: [A.meta, [B.meta, [B.meta, null]], [C.meta, null]],
                                    constPaths: Immutable.fromJS([[0, 0, 0]]),
                                    constVals: Immutable.fromJS(["y"]),
                                    capturePaths: Immutable.fromJS([[1]])}));
    });
    it('should handle list patterns with discards', () => {
      expect(Immutable.fromJS(Skeleton.analyzeAssertion([__, __])))
        .to.equal(Immutable.fromJS({skeleton: [2, null, null],
                                    constPaths: Immutable.fromJS([]),
                                    constVals: Immutable.fromJS([]),
                                    capturePaths: Immutable.fromJS([])}));
    });
    it('should handle list patterns with constants and captures', () => {
      expect(Immutable.fromJS(Skeleton.analyzeAssertion(["hi", _$, _$])))
        .to.equal(Immutable.fromJS({skeleton: [3, null, null, null],
                                    constPaths: Immutable.fromJS([[0]]),
                                    constVals: Immutable.fromJS(["hi"]),
                                    capturePaths: Immutable.fromJS([[1],[2]])}));
    });
  });

  describe('nested structs', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(Skeleton.analyzeAssertion(A(B(_$), _$)), eventCallback(traceHolder, "AB"));
      i.addHandler(Skeleton.analyzeAssertion(A(B("x"), _$)), eventCallback(traceHolder, "ABx"));
      let complexConstantPattern1 = {skeleton: [A.meta, null, [C.meta, null]],
                                    constPaths: Immutable.fromJS([[0]]),
                                    constVals: Immutable.fromJS([B("y")]),
                                    capturePaths: Immutable.fromJS([[1, 0]])};
      // ^ See comment in 'should handle complex constants (1)' test above (marked (***)).
      i.addHandler(complexConstantPattern1, eventCallback(traceHolder, "AByC"));
      let complexConstantPattern2 = {skeleton: [A.meta, [B.meta, null], [C.meta, null]],
                                     constPaths: Immutable.fromJS([[0, 0]]),
                                     constVals: Immutable.fromJS([B("y")]),
                                     capturePaths: Immutable.fromJS([[1]])};
      i.addHandler(complexConstantPattern2, eventCallback(traceHolder, "ABByC"));

      i.addAssertion(A(B("x"),C(1)));
      i.addAssertion(A(B("y"),C(2)));
      i.addAssertion(A(B(B("y")),C(2)));
      i.addAssertion(A(B("z"),C(3)));
    });

    // trace.forEach((e) => { console.log(e.toString()) });

    expect(trace)
      .to.equal(Immutable.List([
        Event("AB", Skeleton.EVENT_ADDED, ["x", C(1)]),
        Event("ABx", Skeleton.EVENT_ADDED, [C(1)]),
        Event("AB", Skeleton.EVENT_ADDED, ["y", C(2)]),
        Event("AByC", Skeleton.EVENT_ADDED, [2]),
        Event("AB", Skeleton.EVENT_ADDED, [B("y"), C(2)]),
        Event("ABByC", Skeleton.EVENT_ADDED, [C(2)]),
        Event("AB", Skeleton.EVENT_ADDED, ["z", C(3)])]));
  });

  describe('simple detail-erasing trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(Skeleton.analyzeAssertion([__, __]), eventCallback(traceHolder, "2-EVENT"));

      i.addAssertion(["hi", 123]);
      i.addAssertion(["hi", 234]);
      i.removeAssertion(["hi", 123]);
      i.removeAssertion(["hi", 234]);
    });

    it('should have one add and one remove', () => {
      expect(trace)
        .to.equal(Immutable.List([
          Event("2-EVENT", Skeleton.EVENT_ADDED, []),
          Event("2-EVENT", Skeleton.EVENT_REMOVED, [])]));
    });
  });

  describe('handler added after assertion (1)', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(["hi", 123, 234]);
      i.addHandler(Skeleton.analyzeAssertion(["hi", _$, _$]), eventCallback(traceHolder, "X"));
      i.removeAssertion(["hi", 123, 234]);
    });

    it('should get two events', () => {
      expect(trace).to.equal(Immutable.List([
        Event("X", Skeleton.EVENT_ADDED, [123, 234]),
        Event("X", Skeleton.EVENT_REMOVED, [123, 234])]));
    });
  });

  describe('handler added after assertion (2)', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(["hi", 123, 234]);
      i.addHandler(Skeleton.analyzeAssertion(_$), eventCallback(traceHolder, "X"));
      i.removeAssertion(["hi", 123, 234]);
    });

    it('should get two events', () => {
      expect(trace).to.equal(Immutable.List([
        Event("X", Skeleton.EVENT_ADDED, [["hi", 123, 234]]),
        Event("X", Skeleton.EVENT_REMOVED, [["hi", 123, 234]])]));
    });
  });

  describe('handler removed before assertion removed', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addAssertion(["hi", 123, 234]);
      let h = Skeleton.analyzeAssertion(["hi", _$, _$]);
      h.callback = eventCallback(traceHolder, "X")
      i.addHandler(h, h.callback);
      i.removeHandler(h, h.callback);
      i.removeAssertion(["hi", 123, 234]);
    });

    it('should get one event', () => {
      expect(trace).to.equal(Immutable.List([
        Event("X", Skeleton.EVENT_ADDED, [123, 234])]));
    });
  });

  describe('simple list assertions trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler(Skeleton.analyzeAssertion(["hi", _$, _$]), eventCallback(traceHolder, "3-EVENT"));
      i.addHandler(Skeleton.analyzeAssertion([__, __]), eventCallback(traceHolder, "2-EVENT"));

      i.addAssertion(["hi", 123, 234]);
      i.addAssertion(["hi", 999, 999]);
      i.addAssertion(["hi", 123]);
      i.addAssertion(["hi", 123, 234]);
      i.sendMessage(["hi", 303]);
      i.sendMessage(["hi", 303, 404]);
      i.sendMessage(["hi", 303, 404, 808]);
      i.removeAssertion(["hi", 123, 234]);
      i.removeAssertion(["hi", 999, 999]);
      i.removeAssertion(["hi", 123, 234]);
      i.addAssertion(["hi", 123]);
      i.addAssertion(["hi", 234]);
      i.removeAssertion(["hi", 123]);
      i.removeAssertion(["hi", 123]);
      i.removeAssertion(["hi", 234]);
    });

    it('should have 8 entries', () => {
      expect(trace.size).to.equal(8);
    });
    it('should have a correct 3-EVENT subtrace', () => {
      expect(trace.filter((e) => { return e[0] === "3-EVENT"; }))
        .to.equal(Immutable.List([
          Event("3-EVENT", Skeleton.EVENT_ADDED, [123, 234]),
          Event("3-EVENT", Skeleton.EVENT_ADDED, [999, 999]),
          Event("3-EVENT", Skeleton.EVENT_MESSAGE, [303, 404]),
          Event("3-EVENT", Skeleton.EVENT_REMOVED, [999, 999]),
          Event("3-EVENT", Skeleton.EVENT_REMOVED, [123, 234])]));
    });
    it('should have a correct 2-EVENT subtrace', () => {
      expect(trace.filter((e) => { return e[0] === "2-EVENT"; }))
        .to.equal(Immutable.List([
          Event("2-EVENT", Skeleton.EVENT_ADDED, []),
          Event("2-EVENT", Skeleton.EVENT_MESSAGE, []),
          Event("2-EVENT", Skeleton.EVENT_REMOVED, [])]));
    });
  });

});
