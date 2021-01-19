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

export type Task<T> = () => T;
export type Script<T> = (f: Facet) => T;

export type MaybeValue = Value | undefined;
export type EndpointSpec = { assertion: MaybeValue, analysis: Skeleton.Analysis | null };

export type ObserverCallback = (facet: Facet, bindings: Array<Value>) => void;

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

export type ActivationScript = Script<void>;

export abstract class Dataspace {
    nextId: ActorId = 0;
    index = new Skeleton.Index();
    dataflow = new Dataflow.Graph<DataflowDependent, DataflowObservable>(
        _canonicalizeDataflowDependent,
        _canonicalizeDataflowObservable);
    runnable: Array<Actor> = [];
    pendingTurns: Array<Turn>;
    actors: IdentityMap<number, Actor> = new IdentityMap();
    activations: IdentitySet<ActivationScript> = new IdentitySet();

    constructor(bootProc: Script<void>) {
        this.pendingTurns = [new Turn(null, [new Spawn(null, bootProc, new Set())])];
    }

    abstract start(): this;
    abstract ground(): Ground;

    backgroundTask(): () => void {
        return this.ground().backgroundTask();
    }

    runTasks(): boolean { // TODO: rename?
        this.runPendingTasks();
        this.performPendingActions();
        return this.runnable.length > 0 || this.pendingTurns.length > 0;
    }

    runPendingTasks() {
        let runnable = this.runnable;
        this.runnable = [];
        runnable.forEach((ac) => { ac.runPendingTasks(); /* TODO: rename? */ });
    }

    performPendingActions() {
        let turns = this.pendingTurns;
        this.pendingTurns = [];
        turns.forEach((turn) => {
            turn.actions.forEach((action) => {
                // console.log('[DATASPACE]', group.actor && group.actor.toString(), action);
                action.perform(this, turn.actor);
                this.runPendingTasks();
            });
        });
    }

    commitActions(ac: Actor, pending: Array<Action>) {
        this.pendingTurns.push(new Turn(ac, pending));
    }

    refreshAssertions() {
        this.dataflow.repairDamage((ep) => {
            let facet = ep.facet;
            if (facet.isLive) { // TODO: necessary test, or tautological?
                facet.invokeScript(f => f.withNonScriptContext(() => ep.refresh()));
            }
        });
    }

    addActor(name: any, bootProc: Script<void>, initialAssertions: Set, parentActor: Actor | null) {
        let ac = new Actor(this, name, initialAssertions, parentActor?.id);
        // debug('Spawn', ac && ac.toString());
        this.applyPatch(ac, ac.adhocAssertions);
        ac.addFacet(null, systemFacet => {
            // Root facet is a dummy "system" facet that exists to hold
            // one-or-more "user" "root" facets.
            ac.addFacet(systemFacet, bootProc);
            // ^ The "true root", user-visible facet.
            initialAssertions.forEach((a) => { ac.adhocRetract(a); });
        });
    }

    applyPatch(ac: Actor, delta: Bag) {
        // if (!delta.isEmpty()) debug('applyPatch BEGIN', ac && ac.toString());
        let removals: Array<[number, Value]> = [];
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

    deliverMessage(m: Value, _sendingActor: Actor | null) {
        // debug('deliverMessage', sendingActor && sendingActor.toString(), m.toString());
        this.index.deliverMessage(m);
        // this.index.deliverMessage(m, (leaf, _m) => {
        //   sendingActor.touchedTopics = sendingActor.touchedTopics.add(leaf);
        // });
    }

    adjustIndex(a: Value, count: number) {
        return this.index.adjustAssertion(a, count);
    }

    subscribe(handler: Skeleton.Analysis) {
        this.index.addHandler(handler, handler.callback!);
    }

    unsubscribe(handler: Skeleton.Analysis) {
        this.index.removeHandler(handler, handler.callback!);
    }

    endpointHook(_facet: Facet, _endpoint: Endpoint) {
        // Subclasses may override
    }
}

export class Actor {
    readonly id: ActorId;
    readonly dataspace: Dataspace;
    readonly name: any;
    rootFacet: Facet | null = null;
    isRunnable: boolean = false;
    readonly pendingTasks: Array<Array<Task<void>>>;
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
        this.pendingTasks = [];
        for (let i = 0; i < Priority._count; i++) { this.pendingTasks.push([]); }
        this.pendingActions = [];
        this.adhocAssertions = new Bag(initialAssertions); // no negative counts allowed
        this.parentId = parentActorId;
        dataspace.actors.set(this.id, this);
    }

    runPendingTasks() {
        while (true) {
            let task = this.popNextTask();
            if (!task) break;
            task();
            this.dataspace.refreshAssertions();
        }

        this.isRunnable = false;
        let pending = this.pendingActions;
        if (pending.length > 0) {
            this.pendingActions = [];
            this.dataspace.commitActions(this, pending);
        }
    }

    popNextTask(): Task<void> | null {
        let tasks = this.pendingTasks;
        for (let i = 0; i < Priority._count; i++) {
            let q = tasks[i];
            if (q.length > 0) return q.shift()!;
        }
        return null;
    }

    abandonQueuedWork() {
        this.pendingActions = [];
        for (let i = 0; i < Priority._count; i++) { this.pendingTasks[i] = []; }
    }

    scheduleTask(task: Task<void>, priority: Priority = Priority.NORMAL) {
        if (!this.isRunnable) {
            this.isRunnable = true;
            this.dataspace.runnable.push(this);
        }
        this.pendingTasks[priority].push(task);
    }

    addFacet(parentFacet: Facet | null, bootProc: Script<void>, checkInScript: boolean = false) {
        if (checkInScript && parentFacet && !parentFacet.inScript) {
            throw new Error("Cannot add facet outside script; are you missing a `react { ... }`?");
        }
        let f = new Facet(this, parentFacet);
        f.invokeScript(f => f.withNonScriptContext(() => bootProc.call(f.fields, f)));
        this.scheduleTask(() => {
            if ((parentFacet && !parentFacet.isLive) || f.isInert()) {
                f._terminate();
            }
        });
    }

    _terminate(emitPatches: boolean) {
        // Abruptly terminates an entire actor, without running stop-scripts etc.
        if (emitPatches) {
            this.scheduleTask(() => {
                this.adhocAssertions.snapshot().forEach((_count, a) => { this.retract(a); });
            });
        }
        if (this.rootFacet) {
            this.rootFacet._abort(emitPatches);
        }
        this.scheduleTask(() => { this.enqueueScriptAction(new Quit()); });
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
    abstract perform(ds: Dataspace, ac: Actor | null): void;
}

class Patch extends Action {
    readonly changes: Bag;

    constructor(changes: Bag) {
        super();
        this.changes = changes;
    }

    perform(ds: Dataspace, ac: Actor | null): void {
        ds.applyPatch(ac!, this.changes);
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

    perform(ds: Dataspace, ac: Actor | null): void {
        ds.deliverMessage(this.body, ac);
    }
}

class Spawn extends Action {
    readonly name: any;
    readonly bootProc: Script<void>;
    readonly initialAssertions: Set;

    constructor(name: any, bootProc: Script<void>, initialAssertions: Set = new Set()) {
        super();
        this.name = name;
        this.bootProc = bootProc;
        this.initialAssertions = initialAssertions;
    }

    perform(ds: Dataspace, ac: Actor | null): void {
        ds.addActor(this.name, this.bootProc, this.initialAssertions, ac);
    }
}

class Quit extends Action { // TODO: rename? Perhaps to Cleanup?
    // Pseudo-action - not for userland use.

    perform(ds: Dataspace, ac: Actor | null): void {
        if (ac === null) throw new Error("Internal error: Quit action with null actor");
        ds.applyPatch(ac, ac.cleanupChanges);
        ds.actors.delete(ac.id);
        // debug('Quit', ac && ac.toString());
    }
}

class DeferredTurn extends Action {
    readonly continuation: Task<void>;

    constructor(continuation: Task<void>) {
        super();
        this.continuation = continuation;
    }

    perform(_ds: Dataspace, ac: Actor | null): void {
        // debug('DeferredTurn', ac && ac.toString());
        ac!.scheduleTask(this.continuation);
    }
}

class Activation extends Action {
    readonly script: ActivationScript;
    readonly name: any;

    constructor(script: ActivationScript, name: any) {
        super();
        this.script = script;
        this.name = name;
    }

    perform(ds: Dataspace, ac: Actor | null): void {
        if (ds.activations.has(this.script)) return;
        ds.activations.add(this.script);
        ds.addActor(this.name, rootFacet => rootFacet.addStartScript(this.script), new Set(), ac);
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
    readonly stopScripts: Array<Script<void>> = [];
    readonly children = new IdentitySet<Facet>();
    readonly fields: any;
    inScript = true;

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

    withNonScriptContext<T>(task: Task<T>): T {
        let savedInScript = this.inScript;
        this.inScript = false;
        try {
            return task();
        } finally {
            this.inScript = savedInScript;
        }
    }

    _abort(emitPatches: boolean) {
        this.isLive = false;
        this.children.forEach(child => child._abort(emitPatches));
        this.retractAssertionsAndSubscriptions(emitPatches);
    }

    retractAssertionsAndSubscriptions(emitPatches: boolean) {
        this.actor.scheduleTask(() => {
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
        ac.scheduleTask(() =>
            this.invokeScript(() =>
                this.stopScripts.forEach(s =>
                    s.call(this.fields, this))));

        this.retractAssertionsAndSubscriptions(true);
        ac.scheduleTask(() => {
            if (parent) {
                if (parent.isInert()) {
                    parent._terminate();
                }
            } else {
                ac._terminate(true);
            }
        }, Priority.GC);
    }

    // This alias exists because of the naive expansion done by the parser.
    _stop(continuation?: Script<void>) {
        this.stop(continuation);
    }

    stop(continuation?: Script<void>) {
        this.parent!.invokeScript(() => {
            this.actor.scheduleTask(() => {
                this._terminate();
                if (continuation) {
                    this.parent!.scheduleScript(parent => continuation.call(this.fields, parent));
                    // ^ TODO: is this the correct scope to use??
                }
            });
        });
    }

    addStartScript(s: Script<void>) {
        this.ensureFacetSetup('`on start`');
        this.scheduleScript(s);
    }

    addStopScript(s: Script<void>) {
        this.ensureFacetSetup('`on stop`');
        this.stopScripts.push(s);
    }

    addEndpoint(updateFun: Script<EndpointSpec>, isDynamic: boolean = true): Endpoint {
        const ep = new Endpoint(this, isDynamic, updateFun);
        this.actor.dataspace.endpointHook(this, ep);
        return ep;
    }

    _addRawObserverEndpoint(specScript: Script<MaybeValue>, callbacks: ObserverCallbacks): Endpoint
    {
        return this.addEndpoint(() => {
            const spec = specScript(this);
            if (spec === void 0) {
                return { assertion: void 0, analysis: null };
            } else {
                const analysis = Skeleton.analyzeAssertion(spec);
                analysis.callback = this.wrap((facet, evt, vs) => {
                    switch (evt) {
                        case Skeleton.EventType.ADDED: callbacks.add?.(facet, vs); break;
                        case Skeleton.EventType.REMOVED: callbacks.del?.(facet, vs); break;
                        case Skeleton.EventType.MESSAGE: callbacks.msg?.(facet, vs); break;
                    }
                });
                return { assertion: Observe(spec), analysis };
            }
        });
    }

    addObserverEndpoint(specThunk: (facet: Facet) => MaybeValue, callbacks: ObserverCallbacks): Endpoint {
        const scriptify = (f?: ObserverCallback) =>
            f && ((facet: Facet, vs: Array<Value>) =>
                facet.scheduleScript(() => f.call(facet.fields, facet, vs)));
        return this._addRawObserverEndpoint(specThunk, {
            add: scriptify(callbacks.add),
            del: scriptify(callbacks.del),
            msg: scriptify(callbacks.msg),
        });
    }

    addDataflow(subjectFun: Script<void>, priority?: Priority): Endpoint {
        return this.addEndpoint(() => {
            let subjectId = this.actor.dataspace.dataflow.currentSubjectId;
            this.scheduleScript(() => {
                if (this.isLive) {
                    this.actor.dataspace.dataflow.withSubject(subjectId, () =>
                        subjectFun.call(this.fields, this));
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

    invokeScript<T>(script: Script<T>, propagateErrors = false): T | undefined {
        try {
            // console.group('Facet', facet && facet.toString());
            return script.call(this.fields, this);
        } catch (e) {
            let a = this.actor;
            a.abandonQueuedWork();
            a._terminate(false);
            console.error('Actor ' + a.toString() + ' exited with exception:', e);
            if (propagateErrors) throw e;
            return undefined;
        } finally {
            // console.groupEnd();
        }
    }

    wrap<T extends Array<any>, R>(fn: (f: Facet, ... args: T) => R): (... args: T) => R {
        return (... actuals) => this.invokeScript(f => fn.call(f.fields, f, ... actuals), true)!;
    }

    wrapExternal<T extends Array<any>>(fn: (f: Facet, ... args: T) => void): (... args: T) => void {
        const ac = this.actor;
        return (... actuals) => {
            if (this.isLive) {
                ac.dataspace.start();
                ac.scheduleTask(() => this.invokeScript(f => fn.call(f.fields, f, ... actuals)));
            }
        };
    }

    ensureFacetSetup(what: string) {
        if (this.inScript) {
            throw new Error(`Cannot ${what} outside facet setup; are you missing \`react { ... }\`?`);
        }
    }

    ensureNonFacetSetup(what: string) {
        if (!this.inScript) {
            throw new Error(`Cannot ${what} during facet setup; are you missing \`on start { ... }\`?`);
        }
    }

    // This alias exists because of the naive expansion done by the parser.
    _send(body: any) {
        this.send(body);
    }

    send(body: any) {
        this.ensureNonFacetSetup('`send`');
        this.enqueueScriptAction(new Message(body));
    }

    // This alias exists because of the naive expansion done by the parser.
    _spawn(name: any, bootProc: Script<void>, initialAssertions?: Set) {
        this.spawn(name, bootProc, initialAssertions);
    }

    spawn(name: any, bootProc: Script<void>, initialAssertions?: Set) {
        this.ensureNonFacetSetup('`spawn`');
        this.enqueueScriptAction(new Spawn(name, bootProc, initialAssertions));
    }

    deferTurn(continuation: Script<void>) {
        this.ensureNonFacetSetup('`deferTurn`');
        this.enqueueScriptAction(new DeferredTurn(this.wrap(continuation)));
    }

    activate(script: ActivationScript, name?: any) {
        this.ensureNonFacetSetup('`activate`');
        this.enqueueScriptAction(new Activation(script, name ?? null));
    }

    scheduleScript(script: Script<void>, priority?: Priority) {
        this.actor.scheduleTask(this.wrap(script), priority);
    }

    declareField<T extends DataflowObservableObject, K extends keyof T & string>(obj: T, prop: K, init: T[K]) {
        if (prop in obj) {
            obj[prop] = init;
        } else {
            this.actor.dataspace.dataflow.defineObservableProperty(obj, prop, init, {
                objectId: [obj, prop],
                noopGuard: is
            });
        }
    }

    // referenceField(obj: DataflowObservableObject, prop: string) {
    //     if (!(prop in obj)) {
    //         this.actor.dataspace.dataflow.recordObservation([obj, prop]);
    //     }
    //     return obj[prop];
    // }

    // deleteField(obj: DataflowObservableObject, prop: string) {
    //     this.actor.dataspace.dataflow.recordDamage([obj, prop]);
    //     delete obj[prop];
    // }

    addChildFacet(bootProc: Script<void>) {
        this.actor.addFacet(this, bootProc, true);
    }

    withSelfDo(t: Script<void>) {
        t(this);
    }
}

export class Endpoint {
    readonly id: EndpointId;
    readonly facet: Facet;
    readonly updateFun: Script<EndpointSpec>;
    spec: EndpointSpec;

    constructor(facet: Facet, isDynamic: boolean, updateFun: Script<EndpointSpec>) {
        facet.ensureFacetSetup('add endpoint');
        let ac = facet.actor;
        let ds = ac.dataspace;
        this.id = ds.nextId++;
        this.facet = facet;
        this.updateFun = updateFun;
        let initialSpec = ds.dataflow.withSubject(isDynamic ? this : undefined,
                                                  () => updateFun.call(facet.fields, facet));
        this._install(initialSpec);
        this.spec = initialSpec; // keeps TypeScript's undefinedness-checker happy
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
        let newSpec = this.updateFun.call(this.facet.fields, this.facet);
        if (newSpec.assertion !== void 0) newSpec.assertion = fromJS(newSpec.assertion);
        if (!is(newSpec.assertion, this.spec.assertion)) {
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
