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

const Immutable = require("immutable");
const Preserves = require("preserves");

const Skeleton = require('./skeleton.js');
const $Special = require('./special.js');
const Bag = require('./bag.js');
const Assertions = require('./assertions.js');
const Dataflow = require('./dataflow.js');

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
  this.activatedModules = Immutable.Set();
  this.actors = Immutable.Map();
}

// Parameters
Dataspace._currentFacet = null;
Dataspace._inScript = true;

Dataspace.BootSteps = Symbol('SyndicateBootSteps');

Dataspace.currentFacet = function () {
  return Dataspace._currentFacet;
};

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
    // console.group('Facet', facet && facet.toString());
    let result = thunk();
    Dataspace._currentFacet = savedFacet;
    return result;
  } catch (e) {
    let a = facet.actor;
    a.abandonQueuedWork();
    a._terminate(false);
    Dataspace._currentFacet = savedFacet;
    console.error('Actor ' + a.toString() + ' exited with exception:', e);
  } finally {
    // console.groupEnd();
  }
};

Dataspace.wrap = function (f) {
  let savedFacet = Dataspace._currentFacet;
  return function () {
    let actuals = arguments;
    Dataspace.withCurrentFacet(savedFacet, function () {
      f.apply(savedFacet.fields, actuals);
    });
  };
};

Dataspace.wrapExternal = function (f) {
  let savedFacet = Dataspace._currentFacet;
  let ac = savedFacet.actor;
  return function () {
    if (savedFacet.isLive) {
      let actuals = arguments;
      ac.dataspace.start();
      ac.pushScript(function () {
        Dataspace.withCurrentFacet(savedFacet, function () {
          f.apply(this, actuals);
        });
      });
    }
  };
};

Dataspace.backgroundTask = function (k) {
  return Dataspace._currentFacet.actor.dataspace.ground().backgroundTask(k);
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
      {
        objectId: Immutable.List.of(obj, prop),
        noopGuard: Preserves.is
      });
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
      // console.log('[DATASPACE]', group.actor && group.actor.toString(), action);
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

Dataspace.prototype.addActor = function (name, bootProc, initialAssertions, parentActor) {
  let ac = new Actor(this, name, initialAssertions, parentActor && parentActor.id);
  this.applyPatch(ac, ac.adhocAssertions.snapshot());
  ac.addFacet(null, () => {
    // Root facet is a dummy "system" facet that exists to hold
    // one-or-more "user" "root" facets.
    ac.addFacet(Dataspace._currentFacet, bootProc);
    // ^ The "true root", user-visible facet.
    initialAssertions.forEach((a) => { ac.adhocRetract(a); });
  });
};

Dataspace.prototype.applyPatch = function (ac, delta) {
  let removals = [];
  delta.forEach((count, a) => {
    if (a !== void 0) {
      if (count > 0) {
        this.adjustIndex(a, count);
      } else {
        removals.push([count, a]);
      }
      if (ac) ac.cleanupChanges.change(a, -count);
    }
  });
  removals.forEach(([count, a]) => {
    this.adjustIndex(a, count);
  });
};

Dataspace.prototype.sendMessage = function (m, sendingActor) {
  this.index.sendMessage(m);
  // this.index.sendMessage(m, (leaf, _m) => {
  //   sendingActor.touchedTopics = sendingActor.touchedTopics.add(leaf);
  // });
};

Dataspace.prototype.adjustIndex = function (a, count) {
  return this.index.adjustAssertion(a, count);
};

Dataspace.prototype.subscribe = function (handler) {
  this.index.addHandler(handler, handler.callback);
};

Dataspace.prototype.unsubscribe = function (handler) {
  this.index.removeHandler(handler, handler.callback);
};

Dataspace.prototype.endpointHook = function (facet, endpoint) {
};

Dataspace.prototype._debugString = function (outerIndent) {
  const pieces = [];
  pieces.push(this.index.root._debugString(outerIndent));
  outerIndent = outerIndent || '\n';
  pieces.push(outerIndent + 'FACET TREE');
  this.actors.forEach((a) => {
    pieces.push(outerIndent + '  ' + a.toString());
    function walkFacet(indent, f) {
      pieces.push(indent + f.toString());
      f.endpoints.forEach((ep) => {
        pieces.push(indent + '  - ' + ep.id + ': ' + (ep.assertion && ep.assertion.toString()));
      });
      f.children.forEach((child) => { walkFacet(indent + '  ', child); });
    }
    a.rootFacet.children.forEach((child) => { walkFacet(outerIndent + '    ', child); });
  });
  pieces.push(outerIndent + 'ACTORS');
  this.actors.forEach((a) => pieces.push(outerIndent + '  ' + a.toString()));
  return pieces.join('');
};

Dataspace.prototype._dotGraph = function () {
  let id = 0;
  const assertionIds = {};

  const nodes = [];
  const edges = [];
  const pieces = [];

  function emitNode(type, id, _label, attrs) {
    const label = _str(_label);
    pieces.push(`\n  ${id} [label=${JSON.stringify(label)}];`);
    nodes.push(Object.assign({}, attrs || {}, {type, id, label}));
  }

  function emitEdge(source, target, maybeDir) {
    pieces.push(`\n  ${source} -- ${target} [dir=${maybeDir || 'none'}];`);
    edges.push({source, target, dir: maybeDir || 'none'});
  }

  function _aId(aStr) {
    // if (aStr.startsWith('observe(Request(') || aStr.startsWith('Request(')) return null;
    // if (aStr.startsWith('observe(Connection(') || aStr.startsWith('Connection(')) return null;
    if (!(aStr in assertionIds)) assertionIds[aStr] = id++;
    return assertionIds[aStr];
  }

  let topics = Immutable.Map();
  function topicForLeaf(leaf) {
    if (topics.has(leaf)) {
      return topics.get(leaf);
    } else {
      const topic = {id: id++, hasEmitter: false, senders: {}, inbound: {}, outbound: {}};
      topics = topics.set(leaf, topic);
      return topic;
    }
  }

  function _str(a) {
    return '' + a;
  }

  pieces.push('graph G {');
  pieces.push('\n  overlap=false;');

  this.actors.forEach((ac) => {
    const acId = ac.id;
    emitNode('actor', `ac_${acId}`, ac.toString());
    if (this.actors.has(ac.parentId)) {
      emitEdge(`ac_${ac.parentId}`, `ac_${acId}`, 'forward');
    }
    // ac.touchedTopics.forEach((leaf) => {
    //   const topic = topicForLeaf(leaf);
    //   topic.senders[acId] = true;
    //   topic.hasEmitter = true;
    // });
    // ac.touchedTopics = Immutable.Set();
    function walkFacet(parent) {
      return (f) => {
        const facetId = id++;
        emitNode('facet', `facet_${facetId}`, `Facet ${f.id}`, {parent});
        emitEdge(parent, `facet_${facetId}`);
        f.endpoints.forEach((ep) => {
          if (ep.assertion !== void 0) {
            const aId = _aId(_str(ep.assertion));
            if (aId) {
              emitNode('endpoint', `ep_${ep.id}`, ep.id);
              emitEdge(`facet_${facetId}`, `ep_${ep.id}`);
              emitEdge(`ep_${ep.id}`, `assn_${aId}`);
            }
          }
        });
        f.children.forEach(walkFacet(`facet_${facetId}`));
      };
    }
    ac.rootFacet.children.forEach(walkFacet(`ac_${acId}`));
  });

  function walkNode(n) {
    n.edges.forEach((table) => table.forEach(walkNode));
    n.continuation.leafMap.forEach((cvMap) => cvMap.forEach((leaf) => {
      const topic = topicForLeaf(leaf);
      leaf.cachedAssertions.forEach((observed_assertion) => {
        const observed_assertion_id = _aId(_str(observed_assertion));
        if (observed_assertion_id) {
          topic.inbound[observed_assertion_id] = true;
          topic.hasEmitter = true;
        }
      });
      leaf.handlerMap.forEach((handler) => {
        handler.callbacks.forEach((cb) => {
          const observing_assertion_id = _aId(_str(cb.__endpoint.handler.assertion));
          if (observing_assertion_id) {
            topic.outbound[observing_assertion_id] = true;
          }
        });
      });
    }));
  }
  walkNode(this.index.root);

  for (const a in assertionIds) {
    emitNode('assertion', `assn_${assertionIds[a]}`, a);
  }

  topics.forEach((topic) => {
    if (topic.hasEmitter) {
      emitNode('topic', 'topic_' + topic.id, ''); // `Topic ${topic.id}`);
      for (const acId in topic.senders) {
        emitEdge(`ac_${acId}`, `topic_${topic.id}`, 'forward');
      }
      for (const aId in topic.inbound) {
        emitEdge(`assn_${aId}`, `topic_${topic.id}`, 'forward');
      }
      for (const aId in topic.outbound) {
        emitEdge(`topic_${topic.id}`, `assn_${aId}`, 'forward');
      }
    }
  });

  pieces.push('\n}');

  require('fs').writeFileSync('d.json', 'var dataspaceContents = ' + JSON.stringify({nodes, edges}, null, 2));

  return pieces.join('');
};

function Actor(dataspace, name, initialAssertions, parentActorId) {
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
  this.parentId = parentActorId;
  // this.touchedTopics = Immutable.Set();
  dataspace.actors = dataspace.actors.set(this.id, this);
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

Actor.prototype._terminate = function (emitPatches) {
  // Abruptly terminates an entire actor, without running stop-scripts etc.
  if (emitPatches) {
    this.pushScript(() => {
      this.adhocAssertions.snapshot().forEach((_count, a) => { this.retract(a); });
    });
  }
  if (this.rootFacet) {
    this.rootFacet._abort(emitPatches);
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

Actor.prototype.adhocRetract = function (a) {
  a = Preserves.fromJS(a);
  if (this.adhocAssertions.change(a, -1, true) === Bag.PRESENT_TO_ABSENT) {
    this.retract(a);
  }
};

Actor.prototype.adhocAssert = function (a) {
  a = Preserves.fromJS(a);
  if (this.adhocAssertions.change(a, +1) === Bag.ABSENT_TO_PRESENT) {
    this.assert(a);
  }
};

Actor.prototype.toString = function () {
  let s = 'Actor(' + this.id;
  if (this.name !== void 0 && this.name !== null) s = s + ',' + this.name.toString();
  return s + ')';
};

function Patch(changes) {
  this.changes = changes;
}

Patch.prototype.perform = function (ds, ac) {
  ds.applyPatch(ac, this.changes);
};

Patch.prototype.adjust = function (a, count) {
  if (a !== void 0) {
    var _net;
    ({bag: this.changes, net: _net} = Bag.change(this.changes, Preserves.fromJS(a), count));
  }
};

function Message(body) {
  this.body = body;
}

Message.prototype.perform = function (ds, ac) {
  if (this.body !== void 0) {
    ds.sendMessage(Preserves.fromJS(this.body), ac);
  }
};

Dataspace.send = function (body) {
  if (!Dataspace._inScript) {
    throw new Error("Cannot `send` during facet setup; are you missing an `on start { ... }`?");
  }
  Dataspace._currentFacet.enqueueScriptAction(new Message(body));
};

function Spawn(name, bootProc, initialAssertions) {
  this.name = name;
  this.bootProc = bootProc;
  this.initialAssertions = initialAssertions || Immutable.Set();
}

Spawn.prototype.perform = function (ds, ac) {
  ds.addActor(this.name, this.bootProc, this.initialAssertions, ac);
};

Dataspace.spawn = function (name, bootProc, initialAssertions) {
  if (!Dataspace._inScript) {
    throw new Error("Cannot `spawn` during facet setup; are you missing an `on start { ... }`?");
  }
  Dataspace._currentFacet.enqueueScriptAction(new Spawn(name, bootProc, initialAssertions));
};

function Quit() { // TODO: rename? Perhaps to Cleanup?
  // Pseudo-action - not for userland use.
}

Quit.prototype.perform = function (ds, ac) {
  ds.applyPatch(ac, ac.cleanupChanges.snapshot());
  ds.actors = ds.actors.remove(ac.id);
};

function DeferredTurn(continuation) {
  this.continuation = continuation;
}

DeferredTurn.prototype.perform = function (ds, ac) {
  ac.pushScript(this.continuation);
};

Dataspace.deferTurn = function (continuation) {
  if (!Dataspace._inScript) {
    throw new Error("Cannot defer turn during facet setup; are you missing an `on start { ... }`?");
  }
  Dataspace._currentFacet.enqueueScriptAction(new DeferredTurn(Dataspace.wrap(continuation)));
};

function Activation(mod) {
  this.mod = mod;
}

Activation.prototype.perform = function (ds, ac) {
  if (!ds.activatedModules.includes(this.mod)) {
    ds.activatedModules = ds.activatedModules.add(this.mod);
    this.mod.exports[Dataspace.BootSteps].steps.forEach((a) => {
      // console.log('[ACTIVATION]', ac && ac.toString(), a);
      a.perform(ds, ac);
    });
  }
};

Dataspace.activate = function (modExports) {
  let { module } = modExports[Dataspace.BootSteps] || {};
  if (module) {
    Dataspace._currentFacet.enqueueScriptAction(new Activation(module));
  }
  return modExports;
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

Facet.prototype._abort = function (emitPatches) {
  this.isLive = false;
  this.children.forEach((child) => { child._abort(emitPatches); });
  this.retractAssertionsAndSubscriptions(emitPatches);
};

Facet.prototype.retractAssertionsAndSubscriptions = function (emitPatches) {
  let ac = this.actor;
  let ds = ac.dataspace;
  ac.pushScript(() => {
    this.endpoints.forEach((ep) => {
      ep.destroy(ds, ac, this, emitPatches);
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

    this.retractAssertionsAndSubscriptions(true);
    ac.pushScript(() => {
      if (parent) {
        if (parent.isInert()) {
          parent._terminate();
        }
      } else {
        ac._terminate(true);
      }
    }, PRIORITY.GC);
  }
};

Facet.prototype.stop = function (continuation) {
  Dataspace.withCurrentFacet(this.parent, () => {
    this.actor.scheduleScript(() => {
      this._terminate();
      this.actor.scheduleScript(() => {
        if (continuation) {
          continuation.call(this.fields); // TODO: is this the correct scope to use??
        }
      });
    });
  });
};

Facet.prototype.addStartScript = function (s) {
  if (Dataspace._inScript) {
    throw new Error("Cannot `on start` outside facet setup");
  }
  this.actor.scheduleScript(s);
};

Facet.prototype.addStopScript = function (s) {
  if (Dataspace._inScript) {
    throw new Error("Cannot `on stop` outside facet setup");
  }
  this.stopScripts = this.stopScripts.push(s);
};

Facet.prototype.addEndpoint = function (updateFun, isDynamic) {
  const ep = new Endpoint(this, isDynamic === void 0 ? true : isDynamic, updateFun);
  this.actor.dataspace.endpointHook(this, ep);
  return ep;
};

Facet.prototype.addDataflow = function (subjectFun, priority) {
  return this.addEndpoint(() => {
    let subjectId = this.actor.dataspace.dataflow.currentSubjectId;
    this.actor.scheduleScript(() => {
      if (this.isLive) {
        this.actor.dataspace.dataflow.withSubject(subjectId, () => subjectFun.call(this.fields));
      }
    }, priority);
    return [void 0, null];
  });
};

Facet.prototype.enqueueScriptAction = function (action) {
  this.actor.enqueueScriptAction(action);
};

Facet.prototype.toString = function () {
  let s = 'Facet(' + this.actor.id;
  if (this.actor.name !== void 0 && this.actor.name !== null) {
    s = s + ',' + this.actor.name.toString();
  }
  s = s + ',' + this.id;
  let f = this.parent;
  while (f != null) {
    s = s + ':' + f.id;
    f = f.parent;
  }
  return s + ')';
};

function ActionCollector() {
  this.actions = [];
}

ActionCollector.prototype.enqueueScriptAction = function (a) {
  this.actions.push(a);
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
  if (this.handler) {
    this.handler.callback.__endpoint = this; // for reflection/debugging
    ds.subscribe(this.handler);
  }
};

Endpoint.prototype._uninstall = function (ds, ac, emitPatches) {
  if (emitPatches) { ac.retract(this.assertion); }
  if (this.handler) { ds.unsubscribe(this.handler); }
};

Endpoint.prototype.refresh = function (ds, ac, facet) {
  let [newAssertion, newHandler] = this.updateFun.call(facet.fields);
  if (newAssertion !== void 0) newAssertion = Preserves.fromJS(newAssertion);
  if (!Immutable.is(newAssertion, this.assertion)) {
    this._uninstall(ds, ac, true);
    this._install(ds, ac, newAssertion, newHandler);
  }
};

Endpoint.prototype.destroy = function (ds, ac, facet, emitPatches) {
  ds.dataflow.forgetSubject([facet, this.id]);
  // ^ TODO: this won't work because of object identity problems! Why
  // does the Racket implementation do this, when the old JS
  // implementation doesn't?
  facet.endpoints = facet.endpoints.remove(this.id);
  this._uninstall(ds, ac, emitPatches);
};

Endpoint.prototype.toString = function () {
  return 'Endpoint(' + this.id + ')';
};

///////////////////////////////////////////////////////////////////////////

module.exports.Dataspace = Dataspace;
module.exports.ActionCollector = ActionCollector;
