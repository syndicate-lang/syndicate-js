"use strict";

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-immutable'));

const Immutable = require('immutable');

const Syndicate = require('../src/main.js');
const Skeleton = Syndicate.Skeleton;
const Struct = Syndicate.Struct;

const Event = Struct.makeConstructor('Event', ['label', 'type', 'values']);

function eventCallback(traceHolder, label) {
  return (e, vs) => {
    traceHolder.trace = traceHolder.trace.push(Event(label, e, vs));
  };
}

function skeletonTrace(f) {
  let traceHolder = {trace: Immutable.List()};
  let i = new Skeleton.Index();
  f(i, traceHolder);
  return traceHolder.trace;
}

describe('skeleton tests', () => {

  const A = Struct.makeConstructor('A', ['x', 'y']);
  const B = Struct.makeConstructor('B', ['v']);
  const C = Struct.makeConstructor('C', ['v']);

  describe('simple detail-erasing trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler([2, null, null],
                   Immutable.fromJS([]),
                   Immutable.fromJS([]),
                   Immutable.fromJS([]),
                   eventCallback(traceHolder, "2-EVENT"));

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

  describe('simple list assertions trace', () => {
    let trace = skeletonTrace((i, traceHolder) => {
      i.addHandler([3, null, null, null],
                   Immutable.fromJS([[0]]),
                   Immutable.fromJS(["hi"]),
                   Immutable.fromJS([[1],[2]]),
                   eventCallback(traceHolder, "3-EVENT"));
      i.addHandler([2, null, null],
                   Immutable.fromJS([]),
                   Immutable.fromJS([]),
                   Immutable.fromJS([]),
                   eventCallback(traceHolder, "2-EVENT"));

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
    // trace.forEach((e) => { console.log(e.toString()) });
  });

});
