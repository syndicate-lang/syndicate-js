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
Dataspace._currentFacet = null;
Dataspace._inScript = true;

Dataspace.currentFacet = function () { return Dataspace._currentFacet; };

Dataspace.withNonScriptContext = function (thunk) {
  let savedInScript = Dataspace._inScript;
  Dataspace._inScript = false;
  try {
    return thunk();
  } finally {
    Dataspace._inScript = savedInScript;
  }
};

Dataspace.withCurrentFacet = function (facet, thunk) {
  let savedFacet = Dataspace._currentFacet;
  Dataspace._currentFacet = facet;
  try {
    let result = thunk();
    Dataspace._currentFacet = savedFacet;
    return result;
  } catch (e) {
    let a = facet.actor;
    a.abandonQueuedWork();
    a._terminate();
    Dataspace._currentFacet = savedFacet;
    throw e;
  }
};

Dataspace.wrap = function (f) {
  let savedFacet = Dataspace._currentFacet;
  return function () {
    let actuals = arguments;
    return Dataspace.withCurrentFacet(savedFacet, function () {
      return f.apply(f.fields, actuals);
    });
  };
};


Dataspace.referenceField = function (obj, prop) {
  if (!(prop in obj)) {
    Dataspace._currentFacet.actor.dataspace.dataflow.recordObservation(
      Immutable.List.of(obj, prop));
  }
  return obj[prop];
};

Dataspace.declareField = function (obj, prop, init) {
  if (prop in obj) {
    obj[prop] = init;
  } else {
    Dataspace._currentFacet.actor.dataspace.dataflow.defineObservableProperty(
      obj,
      prop,
      init,
      { objectId: Immutable.List.of(obj, prop) });
  }
};

Dataspace.deleteField = function (obj, prop) {
  Dataspace._currentFacet.actor.dataspace.dataflow.recordDamage(Immutable.List.of(obj, prop));
  return delete obj[prop];
};

Dataspace.prototype.runScripts = function () { // TODO: rename?
  this.runPendingScripts();
  this.performPendingActions();
  return !this.runnable.isEmpty() || !this.pendingActions.isEmpty();
};

Dataspace.prototype.runPendingScripts = function () {
  let runnable = this.runnable;
  this.runnable = Immutable.List();
  runnable.forEach((ac) => { ac.runPendingScripts(); /* TODO: rename? */ });
};

Dataspace.prototype.performPendingActions = function () {
  let groups = this.pendingActions;
  this.pendingActions = Immutable.List();
  groups.forEach((group) => {
    group.actions.forEach((action) => {
      action.perform(this, group.actor);
      this.runPendingScripts();
    });
  });
};

Dataspace.prototype.commitActions = function (ac, pending) {
  this.pendingActions = this.pendingActions.push(new ActionGroup(ac, pending));
};

Dataspace.prototype.refreshAssertions = function () {
  Dataspace.withNonScriptContext(() => {
    this.dataflow.repairDamage((subjectId) => {
      let [facet, eid] = subjectId;
      if (facet.isLive) { // TODO: necessary test, or tautological?
        let ac = facet.actor;
        Dataspace.withCurrentFacet(facet, () => {
          facet.endpoints.get(eid).refresh(this, ac, facet);
        });
      }
    });
  });
};

Dataspace.prototype.addActor = function (name, bootProc, initialAssertions) {
  let ac = new Actor(this, name, initialAssertions);
  this.applyPatch(ac, ac.adhocAssertions.snapshot());
  ac.addFacet(null, () => {
    // Root facet is a dummy "system" facet that exists to hold
    // one-or-more "user" "root" facets.
    ac.addFacet(Dataspace.currentFacet(), bootProc);
    // ^ The "true root", user-visible facet.
    initialAssertions.forEach((a) => { ac.adhocRetract(a); });
  });
};

Dataspace.prototype.applyPatch = function (ac, delta) {
  delta.forEach((count, a) => {
    if (a !== void 0) {
      this.index.adjustAssertion(a, count);
      ac.cleanupChanges.change(a, -count);
    }
  });
};

Dataspace.prototype.subscribe = function (handler) {
  this.index.addHandler(handler, handler.callback);
};

Dataspace.prototype.unsubscribe = function (handler) {
  this.index.removeHandler(handler, handler.callback);
};

function Actor(dataspace, name, initialAssertions) {
  this.id = dataspace.nextId++;
  this.dataspace = dataspace;
  this.name = name;
  this.rootFacet = null;
  this.isRunnable = false;
  this.pendingScripts = [];
  for (let i = 0; i < PRIORITY._count; i++) { this.pendingScripts.push(Immutable.List()); }
  this.pendingActions = Immutable.List();
  this.adhocAssertions = new Bag.MutableBag(initialAssertions); // no negative counts allowed
  this.cleanupChanges = new Bag.MutableBag();  // negative counts allowed!
}

Actor.prototype.runPendingScripts = function () {
  while (true) {
    let script = this.popNextScript();
    if (!script) break;
    script();
    this.dataspace.refreshAssertions();
  }

  this.isRunnable = false;
  let pending = this.pendingActions;
  if (!pending.isEmpty()) {
    this.pendingActions = Immutable.List();
    this.dataspace.commitActions(this, pending);
  }
};

Actor.prototype.popNextScript = function () {
  let scripts = this.pendingScripts;
  for (let i = 0; i < PRIORITY._count; i++) {
    let q = scripts[i];
    if (!q.isEmpty()) {
      scripts[i] = q.shift();
      return q.first();
    }
  }
  return null;
};

Actor.prototype.abandonQueuedWork = function () {
  this.pendingActions = Immutable.List();
  for (let i = 0; i < PRIORITY._count; i++) { this.pendingScripts[i] = Immutable.List(); }
};

Actor.prototype.scheduleScript = function (unwrappedThunk, priority) {
  this.pushScript(Dataspace.wrap(unwrappedThunk), priority);
};

Actor.prototype.pushScript = function (wrappedThunk, priority) {
  // The wrappedThunk must already have code for ensuring
  // _currentFacet is correct inside it. Compare with scheduleScript.
  if (priority === void 0) {
    priority = PRIORITY.NORMAL;
  }
  if (!this.isRunnable) {
    this.isRunnable = true;
    this.dataspace.runnable = this.dataspace.runnable.push(this);
  }
  this.pendingScripts[priority] = this.pendingScripts[priority].push(wrappedThunk);
};

Actor.prototype.addFacet = function (parentFacet, bootProc, checkInScript) {
  if (checkInScript === true && !Dataspace._inScript) {
    throw new Error("Cannot add facet outside script; are you missing a `react { ... }`?");
  }
  let f = new Facet(this, parentFacet);
  Dataspace.withCurrentFacet(f, () => {
    Dataspace.withNonScriptContext(() => {
      bootProc.call(f.fields);
    });
  });
  this.pushScript(() => {
    if ((parentFacet && !parentFacet.isLive) || f.isInert()) {
      f._terminate();
    }
  });
};

Actor.prototype._terminate = function () {
  // Abruptly terminates an entire actor, without running stop-scripts etc.
  this.pushScript(() => {
    this.adhocAssertions.snapshot().forEach((_count, a) => { this.retract(a); });
  });
  if (this.rootFacet) {
    this.rootFacet._abort();
  }
  this.pushScript(() => { this.enqueueScriptAction(new Quit()); });
};

Actor.prototype.enqueueScriptAction = function (action) {
  this.pendingActions = this.pendingActions.push(action);
};

Actor.prototype.pendingPatch = function () {
  if (!this.pendingActions.isEmpty()) {
    let p = this.pendingActions.last();
    if (p instanceof Patch) {
      return p;
    }
  }

  let p = new Patch(Bag.Bag());
  this.enqueueScriptAction(p);
  return p;
};

Actor.prototype.assert = function (a) { this.pendingPatch().adjust(a, +1); };
Actor.prototype.retract = function (a) { this.pendingPatch().adjust(a, -1); };

Actor.prototype.toString = function () {
  let s = 'Actor(' + this.id;
  if (this.name !== void 0) s = s + ',' + JSON.stringify(this.name);
  return s + ')';
};

function Patch(changes) {
  this.changes = changes;
}

Patch.prototype.perform = function (ds, ac) {
  ds.applyPatch(ac, this.changes);
};

Patch.prototype.adjust = function (a, count) {
  var _net;
  ({bag: this.changes, net: _net} = Bag.change(this.changes, a, count));
};

function Message(body) {
  this.body = body;
}

Message.prototype.perform = function (ds, ac) {
  if (this.body !== void 0) {
    ds.index.sendMessage(this.body);
  }
};

Dataspace.send = function (body) {
  Dataspace._currentFacet.actor.enqueueScriptAction(new Message(body));
};

function Spawn(name, bootProc, initialAssertions) {
  this.name = name;
  this.bootProc = bootProc;
  this.initialAssertions = initialAssertions || Immutable.Set();
}

Spawn.prototype.perform = function (ds, ac) {
  ds.addActor(this.name, this.bootProc, this.initialAssertions);
};

Dataspace.spawn = function (name, bootProc, initialAssertions) {
  let a = new Spawn(name, bootProc, initialAssertions);
  Dataspace._currentFacet.actor.enqueueScriptAction(a);
};

function Quit() { // TODO: rename? Perhaps to Cleanup?
  // Pseudo-action - not for userland use.
}

Quit.prototype.perform = function (ds, ac) {
  ds.applyPatch(ac, ac.cleanupChanges.snapshot());
};

function DeferredTurn(continuation) {
  this.continuation = continuation;
}

DeferredTurn.prototype.perform = function (ds, ac) {
  ac.pushScript(this.continuation);
};

Dataspace.deferTurn = function (continuation) {
  Dataspace._currentFacet.actor.enqueueScriptAction(new DeferredTurn(Dataspace.wrap(continuation)));
};

function ActionGroup(actor, actions) {
  this.actor = actor;
  this.actions = actions;
}

function Facet(actor, parent) {
  this.id = actor.dataspace.nextId++;
  this.isLive = true;
  this.actor = actor;
  this.parent = parent;
  this.endpoints = Immutable.Map();
  this.stopScripts = Immutable.List();
  this.children = Immutable.Set();
  if (parent) {
    parent.children = parent.children.add(this);
    this.fields = Dataflow.Graph.newScope(parent.fields);
  } else {
    if (actor.rootFacet) {
      throw new Error("INVARIANT VIOLATED: Attempt to add second root facet");
    }
    actor.rootFacet = this;
    this.fields = Dataflow.Graph.newScope({});
  }
}

Facet.prototype._abort = function () {
  this.isLive = false;
  this.children.forEach((child) => { child._abort(); });
  this.retractAssertionsAndSubscriptions();
};

Facet.prototype.retractAssertionsAndSubscriptions = function () {
  let ac = this.actor;
  let ds = ac.dataspace;
  ac.pushScript(() => {
    this.endpoints.forEach((ep) => {
      ep.destroy(ds, ac, this);
    });
    this.endpoints = Immutable.Map();
  });
};

Facet.prototype.isInert = function () {
  return this.endpoints.isEmpty() && this.children.isEmpty();
};

Facet.prototype._terminate = function () {
  if (this.isLive) {
    let ac = this.actor;
    let parent = this.parent;
    if (parent) {
      parent.children = parent.children.remove(this);
    } else {
      ac.rootFacet = null;
    }
    this.isLive = false;

    this.children.forEach((child) => { child._terminate(); });

    // Run stop-scripts after terminating children. This means that
    // children's stop-scripts run before ours.
    ac.pushScript(() => {
      Dataspace.withCurrentFacet(this, () => {
        this.stopScripts.forEach((s) => { s.call(this.fields); });
      });
    });

    this.retractAssertionsAndSubscriptions();
    ac.pushScript(() => {
      if (parent) {
        if (parent.isInert()) {
          parent._terminate();
        }
      } else {
        ac._terminate();
      }
    }, PRIORITY.GC);
  }
};

Facet.prototype.stop = function (continuation) {
  Dataspace.withCurrentFacet(this.parent, () => {
    this.actor.scheduleScript(() => {
      this._terminate();
      this.actor.scheduleScript(() => {
        continuation.call(this.fields); // TODO: is this the correct scope to use??
      });
    });
  });
};

Facet.prototype.addStopScript = function (s) {
  this.stopScripts = this.stopScripts.push(s);
};

Facet.prototype.addEndpoint = function (updateFun, isDynamic) {
  return new Endpoint(this, isDynamic === void 0 ? true : isDynamic, updateFun);
};

Facet.prototype.addDataflow = function (subjectFun, priority) {
  return this.addEndpoint(() => {
    let subjectId = this.actor.dataspace.dataflow.currentSubjectId;
    this.actor.scheduleScript(() => {
      this.actor.dataspace.dataflow.withSubject(subjectId, () => subjectFun.call(this.fields));
    }, priority);
    return [void 0, null];
  });
};

Facet.prototype.toString = function () {
  let s = 'Facet(' + this.actor.id;
  if (this.actor.name !== void 0) s = s + ',' + JSON.stringify(this.actor.name);
  s = s + ',' + this.id;
  let f = this.parent;
  while (f != null) {
    s = s + ':' + f.id;
    f = f.parent;
  }
  return s + ')';
};

function Endpoint(facet, isDynamic, updateFun) {
  if (Dataspace._inScript) {
    throw new Error("Cannot add endpoint in script; are you missing a `react { ... }`?");
  }
  let ac = facet.actor;
  let ds = ac.dataspace;
  this.id = ds.nextId++;
  this.updateFun = updateFun;
  let [initialAssertion, initialHandler] = ds.dataflow.withSubject(
    isDynamic ? [facet, this.id] : false,
    () => updateFun.call(facet.fields));
  this._install(ds, ac, initialAssertion, initialHandler);
  facet.endpoints = facet.endpoints.set(this.id, this);
}

Endpoint.prototype._install = function (ds, ac, assertion, handler) {
  this.assertion = assertion;
  this.handler = handler;
  ac.assert(this.assertion);
  if (this.handler) { ds.subscribe(this.handler); }
};

Endpoint.prototype._uninstall = function (ds, ac) {
  ac.retract(this.assertion);
  if (this.handler) { ds.unsubscribe(this.handler); }
};

Endpoint.prototype.refresh = function (ds, ac, facet) {
  let [newAssertion, newHandler] = this.updateFun.call(facet.fields);
  newAssertion = Immutable.fromJS(newAssertion);
  if (!Immutable.is(newAssertion, this.assertion)) {
    this._uninstall(ds, ac);
    this._install(ds, ac, newAssertion, newHandler);
  }
};

Endpoint.prototype.destroy = function (ds, ac, facet) {
  ds.dataflow.forgetSubject([facet, this.id]);
  // ^ TODO: this won't work because of object identity problems! Why
  // does the Racket implementation do this, when the old JS
  // implementation doesn't?
  this._uninstall(ds, ac);
};

Endpoint.prototype.toString = function () {
  return 'Endpoint(' + this.id + ')';
};

///////////////////////////////////////////////////////////////////////////

module.exports.Dataspace = Dataspace;
