"use strict";

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-immutable'));

const Immutable = require('immutable');

const Syndicate = require('../src/main.js');
const Skeleton = Syndicate.Skeleton;
const Struct = Syndicate.Struct;

const Event = Struct.makeConstructor('Event', ['label', 'type', 'values']);

describe('simple list assertions trace', () => {
  let trace = Immutable.List();
  let i = new Skeleton.Index();
  i.addHandler([3, null, null, null],
               Immutable.fromJS([[0]]),
               Immutable.fromJS(["hi"]),
               Immutable.fromJS([[1],[2]]),
               (e, vs) => {
                 trace = trace.push(Event("3-EVENT", e, vs));
               });
  i.addHandler([2, null, null],
               Immutable.fromJS([]),
               Immutable.fromJS([]),
               Immutable.fromJS([]),
               (e, vs) => {
                 trace = trace.push(Event("2-EVENT", e, vs));
               });
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
  it('should have 8 entries', () => {
    expect(trace.size).to.equal(8);
  });
  it('should have two 3-EVENT adds', () => {
    expect(trace.filter((e) => { return e[0] === "3-EVENT" && e[1] === Skeleton.EVENT_ADDED; }))
      .to.equal(Immutable.List([
        Event("3-EVENT", Skeleton.EVENT_ADDED, Immutable.List([123, 234])),
        Event("3-EVENT", Skeleton.EVENT_ADDED, Immutable.List([999, 999]))]));
  });
  it('should have two 3-EVENT removals', () => {
    expect(trace.filter((e) => { return e[0] === "3-EVENT" && e[1] === Skeleton.EVENT_REMOVED; }))
      .to.equal(Immutable.List([
        Event("3-EVENT", Skeleton.EVENT_REMOVED, Immutable.List([999, 999])),
        Event("3-EVENT", Skeleton.EVENT_REMOVED, Immutable.List([123, 234]))]));
  });
  it('should have one 2-EVENT add', () => {
    expect(trace.filter((e) => { return e[0] === "2-EVENT" && e[1] === Skeleton.EVENT_ADDED; }))
      .to.equal(Immutable.List([
        Event("2-EVENT", Skeleton.EVENT_ADDED, Immutable.List([]))]));
  });
  it('should have one 2-EVENT removal', () => {
    expect(trace.filter((e) => { return e[0] === "2-EVENT" && e[1] === Skeleton.EVENT_REMOVED; }))
      .to.equal(Immutable.List([
        Event("2-EVENT", Skeleton.EVENT_REMOVED, Immutable.List([]))]));
  });
  it('should have two messages', () => {
    expect(trace.filter((e) => { return e[1] === Skeleton.EVENT_MESSAGE; }))
      .to.equal(Immutable.List([
        Event("2-EVENT", Skeleton.EVENT_MESSAGE, Immutable.List([])),
        Event("3-EVENT", Skeleton.EVENT_MESSAGE, Immutable.List([303, 404]))]));
  });
  trace.forEach((e) => { console.log(e.toString()) });
});
