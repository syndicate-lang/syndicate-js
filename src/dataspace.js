"use strict";

const Immutable = require("immutable");
const Struct = require('./struct.js');
const Skeleton = require('./skeleton.js');
const $Special = require('./special.js');
const Bag = require('./bag.js');
const Assertions = require('./assertions.js');
const Dataflow = require('./dataflow.js');

const __ = Struct.__;
const _$ = Struct._$;

const PRIORITY = Object.freeze({
  QUERY_HIGH: 0,
  QUERY: 1,
  QUERY_HANDLER: 2,
  NORMAL: 3,
  GC: 4,
  IDLE: 5,
  _count: 6
});

function Dataspace(bootProc) {
  this.nextId = 0;
  this.index = new Skeleton.Index();
  this.dataflow = new Dataflow.Graph();
  this.runnable = Immutable.List();
  this.pendingActions = Immutable.List([
    new ActionGroup(null, Immutable.List([new Spawn(null, bootProc, Immutable.Set())]))]);
}

// Parameters
Dataspace.currentFacet = null;
Dataspace.inScript = true;

function Actor(dataspace, name) {
  this.id = dataspace.nextId++;
  this.dataspace = dataspace;
  this.name = name;
  this.rootFacet = null;
  this.isRunnable = false;
  this.pendingScripts = [];
  for (let i = 0; i < PRIORITY._count; i++) { this.pendingScripts.push(Immutable.List()); }
  this.pendingActions = Immutable.List();
  this.adhocAssertions = new Bag.MutableBag(); // no negative counts allowed
  this.cleanupChanges = new Bag.MutableBag();  // negative counts allowed!
}

Actor.prototype.toString = function () {
  let s = 'Actor(' + this.id;
  if (typeof this.name !== 'undefined') s = s + ',' + JSON.stringify(this.name);
  return s + ')';
};

function Patch(changes) {
  this.changes = changes;
}

function Message(body) {
  this.body = body;
}

function Spawn(name, bootProc, initialAssertions) {
  this.name = name;
  this.bootProc = bootProc;
  this.initialAssertions = initialAssertions;
}

function Quit() {
}

function DeferredTurn(continuation) {
  this.continuation = continuation;
}

function ActionGroup(actor, actions) {
  this.actor = actor;
  this.actions = actions;
}

function Facet(actor, parent) {
  this.id = actor.dataspace.nextId++;
  this.isLive = true;
  this.actor = actor;
  this.parent = parent;
  this.endpoints = {};
  this.stopScripts = Immutable.List();
  this.children = Immutable.Set();
}

Facet.prototype.toString = function () {
  let s = 'Facet(' + this.actor.id;
  if (typeof this.actor.name !== 'undefined') s = s + ',' + JSON.stringify(this.actor.name);
  s = s + ',' + this.id;
  let f = this.parent;
  while (f != null) {
    s = s + ':' + f.id;
    f = f.parent;
  }
  return s + ')';
};

function Endpoint(id, assertion, handler, updateFun) {
  this.id = id;
  this.assertion = assertion;
  this.handler = handler;
  this.updateFun = updateFun;
}

Endpoint.prototype.toString = function () {
  return 'Endpoint(' + this.id + ')';
};

function Handler(staticInfo, callback) {
  this.staticInfo = staticInfo;
  this.callback = callback;
}

///////////////////////////////////////////////////////////////////////////

