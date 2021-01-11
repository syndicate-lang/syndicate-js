//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
// Copyright (C) 2016-2021 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
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

import { Value, fromJS, is, Set } from 'preserves';

import * as Skeleton from './skeleton.js';
import { Bag, ChangeDescription } from './bag.js';
import { Observe } from './assertions.js';
import * as Dataflow from './dataflow.js';
import { IdentitySet, IdentityMap } from './idcoll.js';
import { Ground } from './ground.js';

export enum Priority {
    QUERY_HIGH = 0,
    QUERY,
    QUERY_HANDLER,
    NORMAL,
    GC,
    IDLE,
    _count
}

export type ActorId = number;
export type FacetId = ActorId;
export type EndpointId = ActorId;

export type Script = () => void;

export type MaybeValue = Value | undefined;
export type EndpointSpec = { assertion: MaybeValue, analysis: Skeleton.Analysis | null };

export type ObserverCallback = (bindings: Array<Value>) => void;

export type ObserverCallbacks = {
    add?: ObserverCallback;
    del?: ObserverCallback;
    msg?: ObserverCallback;
}

export const DataflowObservableObjectId = Symbol.for('DataflowObservableObjectId');
export interface DataflowObservableObject {
    [DataflowObservableObjectId](): number;
}

export type DataflowObservable = [DataflowObservableObject, string];
export function _canonicalizeDataflowObservable(i: DataflowObservable): string {
    return i[0][DataflowObservableObjectId]() + ',' + i[1];
}

export type DataflowDependent = Endpoint;
export function _canonicalizeDataflowDependent(i: DataflowDependent): string {
    return '' + i.id;
}

export abstract class Dataspace {
    nextId: ActorId = 0;
    index = new Skeleton.Index();
    dataflow = new Dataflow.Graph<DataflowDependent, DataflowObservable>(
        _canonicalizeDataflowDependent,
        _canonicalizeDataflowObservable);
    runnable: Array<Actor> = [];
    pendingTurns: Array<Turn>;
    actors: IdentityMap<number, Actor> = new IdentityMap();

    constructor(bootProc: Script) {
        this.pendingTurns = [new Turn(null, [new Spawn(null, bootProc, new Set())])];
    }

    static _currentFacet: Facet | null = null;
    static _inScript = true;

    static get currentFacet(): Facet | null {
        return Dataspace._currentFacet;
    }

    static withNonScriptContext<T>(thunk: () => T) {
        let savedInScript = Dataspace._inScript;
        Dataspace._inScript = false;
        try {
            return thunk();
        } finally {
            Dataspace._inScript = savedInScript;
        }
    }

    static withCurrentFacet<T>(facet: Facet, thunk: () => T) {
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
    }

    static wrap<T extends Array<any>, R>(f: (... args: T) => R): (... args: T) => R {
        const savedFacet = Dataspace._currentFacet;
        return (... actuals) =>
            Dataspace.withCurrentFacet(savedFacet, () => f.apply(savedFacet.fields, actuals));
    }

    abstract start(): this;
    abstract ground(): Ground;

    static wrapExternal<T extends Array<any>>(f: (... args: T) => void): (... args: T) => void {
        const savedFacet = Dataspace._currentFacet;
        const ac = savedFacet.actor;
        return (... actuals) => {
            if (savedFacet.isLive) {
                ac.dataspace.start();
                ac.pushScript(() =>
                    Dataspace.withCurrentFacet(savedFacet, () =>
                        f.apply(savedFacet.fields, actuals)));
            }
        };
    }

    static backgroundTask(): () => void {
        return Dataspace._currentFacet.actor.dataspace.ground().backgroundTask();
    }

    static referenceField(obj: DataflowObservableObject, prop: string) {
        if (!(prop in obj)) {
            Dataspace._currentFacet.actor.dataspace.dataflow.recordObservation([obj, prop]);
        }
        return obj[prop];
    }

    static declareField(obj: DataflowObservableObject, prop: string, init: any) {
        if (prop in obj) {
            obj[prop] = init;
        } else {
            Dataspace._currentFacet.actor.dataspace.dataflow.defineObservableProperty(
                obj,
                prop,
                init,
                {
                    objectId: [obj, prop],
                    noopGuard: is
                });
        }
    }

    static deleteField(obj: DataflowObservableObject, prop: string) {
        Dataspace._currentFacet.actor.dataspace.dataflow.recordDamage([obj, prop]);
        delete obj[prop];
    }

    runScripts() { // TODO: rename?
        this.runPendingScripts();
        this.performPendingActions();
        return this.runnable.length > 0 || this.pendingTurns.length > 0;
    }

    runPendingScripts() {
        let runnable = this.runnable;
        this.runnable = [];
        runnable.forEach((ac) => { ac.runPendingScripts(); /* TODO: rename? */ });
    }

    performPendingActions() {
        let turns = this.pendingTurns;
        this.pendingTurns = [];
        turns.forEach((turn) => {
            turn.actions.forEach((action) => {
                // console.log('[DATASPACE]', group.actor && group.actor.toString(), action);
                action.perform(this, turn.actor);
                this.runPendingScripts();
            });
        });
    }

    commitActions(ac: Actor, pending: Array<Action>) {
        this.pendingTurns.push(new Turn(ac, pending));
    }

    refreshAssertions() {
        Dataspace.withNonScriptContext(() => {
            this.dataflow.repairDamage((ep) => {
                let facet = ep.facet;
                if (facet.isLive) { // TODO: necessary test, or tautological?
                    Dataspace.withCurrentFacet(facet, () => ep.refresh());
                }
            });
        });
    }

    addActor(name: any, bootProc: Script, initialAssertions: Set, parentActor: Actor | undefined) {
        let ac = new Actor(this, name, initialAssertions, parentActor?.id);
        // debug('Spawn', ac && ac.toString());
        this.applyPatch(ac, ac.adhocAssertions);
        ac.addFacet(null, () => {
            // Root facet is a dummy "system" facet that exists to hold
            // one-or-more "user" "root" facets.
            ac.addFacet(Dataspace._currentFacet, bootProc);
            // ^ The "true root", user-visible facet.
            initialAssertions.forEach((a) => { ac.adhocRetract(a); });
        });
    }

    applyPatch(ac: Actor, delta: Bag) {
        // if (!delta.isEmpty()) debug('applyPatch BEGIN', ac && ac.toString());
        let removals = [];
        delta.forEach((count, a) => {
            if (count > 0) {
                // debug('applyPatch +', a && a.toString());
                this.adjustIndex(a, count);
            } else {
                removals.push([count, a]);
            }
            if (ac) ac.cleanupChanges.change(a, -count);
        });
        removals.forEach(([count, a]) => {
            // debug('applyPatch -', a && a.toString());
            this.adjustIndex(a, count);
        });
        // if (!delta.isEmpty()) debug('applyPatch END');
    }

    sendMessage(m: Value, _sendingActor: Actor) {
        // debug('sendMessage', sendingActor && sendingActor.toString(), m.toString());
        this.index.sendMessage(m);
        // this.index.sendMessage(m, (leaf, _m) => {
        //   sendingActor.touchedTopics = sendingActor.touchedTopics.add(leaf);
        // });
    }

    adjustIndex(a: Value, count: number) {
        return this.index.adjustAssertion(a, count);
    }

    subscribe(handler: Skeleton.Analysis) {
        this.index.addHandler(handler, handler.callback);
    }

    unsubscribe(handler: Skeleton.Analysis) {
        this.index.removeHandler(handler, handler.callback);
    }

    endpointHook(_facet: Facet, _endpoint: Endpoint) {
        // Subclasses may override
    }

    static send(body: any) {
        if (!Dataspace._inScript) {
            throw new Error("Cannot `send` during facet setup; are you missing an `on start { ... }`?");
        }
        Dataspace._currentFacet.enqueueScriptAction(new Message(body));
    }

    static spawn(name: any, bootProc: Script, initialAssertions?: Set) {
        if (!Dataspace._inScript) {
            throw new Error("Cannot `spawn` during facet setup; are you missing an `on start { ... }`?");
        }
        Dataspace._currentFacet.enqueueScriptAction(new Spawn(name, bootProc, initialAssertions));
    }

    static deferTurn(continuation: Script) {
        if (!Dataspace._inScript) {
            throw new Error("Cannot defer turn during facet setup; are you missing an `on start { ... }`?");
        }
        Dataspace._currentFacet.enqueueScriptAction(new DeferredTurn(Dataspace.wrap(continuation)));
    }
}

export class Actor {
    readonly id: ActorId;
    readonly dataspace: Dataspace;
    readonly name: any;
    rootFacet: Facet | null = null;
    isRunnable: boolean = false;
    readonly pendingScripts: Array<Array<Script>>;
    pendingActions: Array<Action>;
    adhocAssertions: Bag;
    cleanupChanges = new Bag(); // negative counts allowed!
    parentId: ActorId | undefined;

    constructor(dataspace: Dataspace,
                name: any,
                initialAssertions: Set,
                parentActorId: ActorId | undefined)
    {
        this.id = dataspace.nextId++;
        this.dataspace = dataspace;
        this.name = name;
        this.isRunnable = false;
        this.pendingScripts = [];
        for (let i = 0; i < Priority._count; i++) { this.pendingScripts.push([]); }
        this.pendingActions = [];
        this.adhocAssertions = new Bag(initialAssertions); // no negative counts allowed
        this.parentId = parentActorId;
        dataspace.actors.set(this.id, this);
    }

    runPendingScripts() {
        while (true) {
            let script = this.popNextScript();
            if (!script) break;
            script();
            this.dataspace.refreshAssertions();
        }

        this.isRunnable = false;
        let pending = this.pendingActions;
        if (pending.length > 0) {
            this.pendingActions = [];
            this.dataspace.commitActions(this, pending);
        }
    }

    popNextScript(): Script | null {
        let scripts = this.pendingScripts;
        for (let i = 0; i < Priority._count; i++) {
            let q = scripts[i];
            if (q.length > 0) return q.shift();
        }
        return null;
    }

    abandonQueuedWork() {
        this.pendingActions = [];
        for (let i = 0; i < Priority._count; i++) { this.pendingScripts[i] = []; }
    }

    scheduleScript(unwrappedThunk: Script, priority?: Priority) {
        this.pushScript(Dataspace.wrap(unwrappedThunk), priority);
    }

    pushScript(wrappedThunk: Script, priority: Priority = Priority.NORMAL) {
        // The wrappedThunk must already have code for ensuring
        // _currentFacet is correct inside it. Compare with scheduleScript.
        if (!this.isRunnable) {
            this.isRunnable = true;
            this.dataspace.runnable.push(this);
        }
        this.pendingScripts[priority].push(wrappedThunk);
    }

    addFacet(parentFacet: Facet, bootProc: Script, checkInScript: boolean = false) {
        if (checkInScript && !Dataspace._inScript) {
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
    }

    _terminate(emitPatches: boolean) {
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
    }

    enqueueScriptAction(action: Action) {
        this.pendingActions.push(action);
    }

    pendingPatch(): Patch {
        if (this.pendingActions.length > 0) {
            let p = this.pendingActions[this.pendingActions.length - 1];
            if (p instanceof Patch) return p;
        }
        let p = new Patch(new Bag());
        this.enqueueScriptAction(p);
        return p;
    }

    assert(a: Value)  { this.pendingPatch().adjust(a, +1); }
    retract(a: Value) { this.pendingPatch().adjust(a, -1); }

    adhocRetract(a: Value) {
        a = fromJS(a);
        if (this.adhocAssertions.change(a, -1, true) === ChangeDescription.PRESENT_TO_ABSENT) {
            this.retract(a);
        }
    }

    adhocAssert(a: Value) {
        a = fromJS(a);
        if (this.adhocAssertions.change(a, +1) === ChangeDescription.ABSENT_TO_PRESENT) {
            this.assert(a);
        }
    }

    toString(): string {
        let s = 'Actor(' + this.id;
        if (this.name !== void 0 && this.name !== null) s = s + ',' + this.name.toString();
        return s + ')';
    }
}

abstract class Action {
    abstract perform(ds: Dataspace, ac: Actor): void;
}

class Patch extends Action {
    readonly changes: Bag;

    constructor(changes: Bag) {
        super();
        this.changes = changes;
    }

    perform(ds: Dataspace, ac: Actor): void {
        ds.applyPatch(ac, this.changes);
    }

    adjust(a: Value, count: number) {
        this.changes.change(fromJS(a), count);
    }
}

class Message extends Action {
    readonly body: Value;

    constructor(body: any) {
        super();
        this.body = fromJS(body);
    }

    perform(ds: Dataspace, ac: Actor): void {
        ds.sendMessage(this.body, ac);
    }
}

class Spawn extends Action {
    readonly name: any;
    readonly bootProc: Script;
    readonly initialAssertions: Set;

    constructor(name: any, bootProc: Script, initialAssertions: Set = new Set()) {
        super();
        this.name = name;
        this.bootProc = bootProc;
        this.initialAssertions = initialAssertions;
    }

    perform(ds: Dataspace, ac: Actor): void {
        ds.addActor(this.name, this.bootProc, this.initialAssertions, ac);
    }
}

class Quit extends Action { // TODO: rename? Perhaps to Cleanup?
    // Pseudo-action - not for userland use.

    perform(ds: Dataspace, ac: Actor): void {
        ds.applyPatch(ac, ac.cleanupChanges);
        ds.actors.delete(ac.id);
        // debug('Quit', ac && ac.toString());
    }
}

class DeferredTurn extends Action {
    readonly continuation: Script;

    constructor(continuation: Script) {
        super();
        this.continuation = continuation;
    }

    perform(_ds: Dataspace, ac: Actor): void {
        // debug('DeferredTurn', ac && ac.toString());
        ac.pushScript(this.continuation);
    }
}

export class Turn {
    readonly actor: Actor | null;
    readonly actions: Array<Action>;

    constructor(actor: Actor | null, actions: Array<Action> = []) {
        this.actor = actor;
        this.actions = actions;
    }

    enqueueScriptAction(a: Action) {
        this.actions.push(a);
    }
}

export class Facet {
    readonly id: FacetId;
    isLive = true;
    readonly actor: Actor;
    readonly parent: Facet | null;
    readonly endpoints = new IdentityMap<EndpointId, Endpoint>();
    readonly stopScripts: Array<Script> = [];
    readonly children = new IdentitySet<Facet>();
    readonly fields: any;

    constructor(actor: Actor, parent: Facet | null) {
        this.id = actor.dataspace.nextId++;
        this.actor = actor;
        this.parent = parent;
        if (parent) {
            parent.children.add(this);
            this.fields = Dataflow.Graph.newScope(parent.fields);
        } else {
            if (actor.rootFacet) {
                throw new Error("INVARIANT VIOLATED: Attempt to add second root facet");
            }
            actor.rootFacet = this;
            this.fields = Dataflow.Graph.newScope({});
        }
        this.fields[DataflowObservableObjectId] = () => this.id;
    }

    _abort(emitPatches: boolean) {
        this.isLive = false;
        this.children.forEach(child => child._abort(emitPatches));
        this.retractAssertionsAndSubscriptions(emitPatches);
    }

    retractAssertionsAndSubscriptions(emitPatches: boolean) {
        this.actor.pushScript(() => {
            this.endpoints.forEach((ep) => ep.destroy(emitPatches));
            this.endpoints.clear();
        });
    }

    isInert(): boolean {
        return this.endpoints.size === 0 && this.children.size === 0;
    }

    _terminate() {
        if (!this.isLive) return;

        let ac = this.actor;
        let parent = this.parent;
        if (parent) {
            parent.children.delete(this);
        } else {
            ac.rootFacet = null;
        }
        this.isLive = false;

        this.children.forEach((child) => { child._terminate(); });

        // Run stop-scripts after terminating children. This means
        // that children's stop-scripts run before ours.
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
        }, Priority.GC);
    }

    stop(continuation?: Script) {
        Dataspace.withCurrentFacet(this.parent, () => {
            this.actor.scheduleScript(() => {
                this._terminate();
                if (continuation) {
                    this.actor.scheduleScript(() => continuation.call(this.fields));
                    // ^ TODO: is this the correct scope to use??
                }
            });
        });
    }

    addStartScript(s: Script) {
        if (Dataspace._inScript) {
            throw new Error("Cannot `on start` outside facet setup");
        }
        this.actor.scheduleScript(s);
    }

    addStopScript(s: Script) {
        if (Dataspace._inScript) {
            throw new Error("Cannot `on stop` outside facet setup");
        }
        this.stopScripts.push(s);
    }

    addEndpoint(updateFun: () => EndpointSpec, isDynamic: boolean = true): Endpoint {
        const ep = new Endpoint(this, isDynamic, updateFun);
        this.actor.dataspace.endpointHook(this, ep);
        return ep;
    }

    _addRawObserverEndpoint(specThunk: () => MaybeValue, callbacks: ObserverCallbacks): Endpoint
    {
        return this.addEndpoint(() => {
            const spec = specThunk();
            if (spec === void 0) {
                return { assertion: void 0, analysis: null };
            } else {
                const analysis = Skeleton.analyzeAssertion(spec);
                analysis.callback = Dataspace.wrap((evt, vs) => {
                    switch (evt) {
                        case Skeleton.EventType.ADDED: callbacks.add?.(vs); break;
                        case Skeleton.EventType.REMOVED: callbacks.del?.(vs); break;
                        case Skeleton.EventType.MESSAGE: callbacks.msg?.(vs); break;
                    }
                });
                return { assertion: Observe(spec), analysis };
            }
        });
    }

    addObserverEndpoint(specThunk: () => MaybeValue, callbacks: ObserverCallbacks): Endpoint {
        const scriptify = (f?: ObserverCallback) =>
            f && ((vs: Array<Value>) => this.actor.scheduleScript(() => f(vs)));
        return this._addRawObserverEndpoint(specThunk, {
            add: scriptify(callbacks.add),
            del: scriptify(callbacks.del),
            msg: scriptify(callbacks.msg),
        });
    }

    addDataflow(subjectFun: Script, priority?: Priority): Endpoint {
        return this.addEndpoint(() => {
            let subjectId = this.actor.dataspace.dataflow.currentSubjectId;
            this.actor.scheduleScript(() => {
                if (this.isLive) {
                    this.actor.dataspace.dataflow.withSubject(subjectId, () =>
                        subjectFun.call(this.fields));
                }
            }, priority);
            return { assertion: void 0, analysis: null };
        });
    }

    enqueueScriptAction(action: Action) {
        this.actor.enqueueScriptAction(action);
    }

    toString(): string {
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
    }
}

export class Endpoint {
    readonly id: EndpointId;
    readonly facet: Facet;
    readonly updateFun: () => EndpointSpec;
    spec: EndpointSpec;

    constructor(facet: Facet, isDynamic: boolean, updateFun: () => EndpointSpec) {
        if (Dataspace._inScript) {
            throw new Error("Cannot add endpoint in script; are you missing a `react { ... }`?");
        }
        let ac = facet.actor;
        let ds = ac.dataspace;
        this.id = ds.nextId++;
        this.facet = facet;
        this.updateFun = updateFun;
        let initialSpec = ds.dataflow.withSubject(isDynamic ? this : undefined,
                                                  () => updateFun.call(facet.fields));
        this._install(initialSpec);
        facet.endpoints.set(this.id, this);
    }

    _install(spec: EndpointSpec) {
        this.spec = spec;
        const ac = this.facet.actor;
        if (this.spec.assertion !== void 0) {
            ac.assert(this.spec.assertion);
        }
        if (this.spec.analysis) ac.dataspace.subscribe(this.spec.analysis);
    }

    _uninstall(emitPatches: boolean) {
        if (emitPatches) {
            if (this.spec.assertion !== void 0) {
                this.facet.actor.retract(this.spec.assertion);
            }
        }
        if (this.spec.analysis) this.facet.actor.dataspace.unsubscribe(this.spec.analysis);
    }

    refresh() {
        let newSpec = this.updateFun.call(this.facet.fields);
        if (newSpec.assertion !== void 0) newSpec.assertion = fromJS(newSpec.assertion);
        if (is(newSpec.assertion, this.spec.assertion)) {
            this._uninstall(true);
            this._install(newSpec);
        }
    }

    destroy(emitPatches: boolean) {
        const facet = this.facet;
        facet.actor.dataspace.dataflow.forgetSubject(this);
        // ^ TODO: this won't work because of object identity problems! Why
        // does the Racket implementation do this, when the old JS
        // implementation doesn't?
        facet.endpoints.delete(this.id);
        this._uninstall(emitPatches);
    }

    toString(): string {
        return 'Endpoint(' + this.id + ')';
    }
}
