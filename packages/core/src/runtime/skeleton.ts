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

import { IdentitySet } from './idcoll.js';
import { is, Value, Record, Set, Dictionary, _canonicalString } from 'preserves';

import { Bag, ChangeDescription } from './bag.js';
import { Discard, Capture, Observe } from './assertions.js';

import * as Stack from './stack.js';

export enum EventType {
    ADDED = +1,
    REMOVED = -1,
    MESSAGE = 0,
}

export type HandlerCallback = (eventType: EventType, bindings: Array<Value>) => void;

export type Shape = string;
export type Skeleton = null | { shape: Shape, members: Skeleton[] };
export type Path = Array<number>;
export interface Analysis {
    skeleton: Skeleton;
    constPaths: Array<Path>;
    constVals: Array<Value>;
    capturePaths: Array<Path>;
    assertion: Value;
    callback?: HandlerCallback;
}

const _nop = () => {};

export class Index {
    readonly allAssertions: Bag = new Bag();
    readonly root: Node = new Node(new Continuation(new Set()));

    addHandler(analysisResults: Analysis, callback: HandlerCallback) {
        let {skeleton, constPaths, constVals, capturePaths} = analysisResults;
        const continuation = this.root.extend(skeleton);
        let constValMap = continuation.leafMap.get(constPaths);
        if (!constValMap) {
            constValMap = new Dictionary();
            continuation.cachedAssertions.forEach((a) => {
                const key = projectPaths(a, constPaths);
                let leaf = constValMap.get(key);
                if (!leaf) {
                    leaf = new Leaf();
                    constValMap.set(key, leaf);
                }
                leaf.cachedAssertions.add(a);
            });
            continuation.leafMap.set(constPaths, constValMap);
        }
        let leaf = constValMap.get(constVals);
        if (!leaf) {
            leaf = new Leaf();
            constValMap.set(constVals, leaf);
        }
        let handler = leaf.handlerMap.get(capturePaths);
        if (!handler) {
            const cachedCaptures = new Bag();
            leaf.cachedAssertions.forEach((a) =>
                cachedCaptures._items.update(projectPaths(a, capturePaths), n => n + 1, 0));
            handler = new Handler(cachedCaptures);
            leaf.handlerMap.set(capturePaths, handler);
        }
        handler.callbacks.add(callback);
        handler.cachedCaptures.forEach((_count, captures) =>
            callback(EventType.ADDED, captures as Array<Value>));
    }

    removeHandler(analysisResults: Analysis, callback: HandlerCallback) {
        let {skeleton, constPaths, constVals, capturePaths} = analysisResults;
        const continuation = this.root.extend(skeleton);
        let constValMap = continuation.leafMap.get(constPaths);
        if (!constValMap) return;
        let leaf = constValMap.get(constVals);
        if (!leaf) return;
        let handler = leaf.handlerMap.get(capturePaths);
        if (!handler) return;
        handler.callbacks.delete(callback);
        if (handler.callbacks.size === 0) {
            leaf.handlerMap.delete(capturePaths);
        }
        if (leaf.isEmpty()) {
            constValMap.delete(constVals);
        }
        if (constValMap.size === 0) {
            continuation.leafMap.delete(constPaths);
        }
    }

    adjustAssertion(outerValue: Value, delta: number): ChangeDescription {
        let net = this.allAssertions.change(outerValue, delta);
        switch (net) {
            case ChangeDescription.ABSENT_TO_PRESENT:
                this.root.modify(
                    EventType.ADDED,
                    outerValue,
                    (c, v) => c.cachedAssertions.add(v),
                    (l, v) => l.cachedAssertions.add(v),
                    (h, vs) => {
                        if (h.cachedCaptures.change(vs, +1) === ChangeDescription.ABSENT_TO_PRESENT)
                            h.callbacks.forEach(cb => cb(EventType.ADDED, vs));
                    });
                break;

            case ChangeDescription.PRESENT_TO_ABSENT:
                this.root.modify(
                    EventType.REMOVED,
                    outerValue,
                    (c, v) => c.cachedAssertions.delete(v),
                    (l, v) => l.cachedAssertions.delete(v),
                    (h, vs) => {
                        if (h.cachedCaptures.change(vs, -1) === ChangeDescription.PRESENT_TO_ABSENT)
                            h.callbacks.forEach(cb => cb(EventType.REMOVED, vs));
                    });
                break;
        }
        return net;
    }

    addAssertion(v: Value) {
        this.adjustAssertion(v, +1);
    }

    removeAssertion(v: Value) {
        this.adjustAssertion(v, -1);
    }

    sendMessage(v: Value, leafCallback: (l: Leaf, v: Value) => void = _nop) {
        this.root.modify(EventType.MESSAGE, v, _nop, leafCallback, (h, vs) =>
            h.callbacks.forEach(cb => cb(EventType.MESSAGE, vs)));
    }
}

class Node {
    readonly continuation: Continuation;
    readonly edges: { [selector: string]: { [shape: string]: Node } } = {};

    constructor(continuation: Continuation) {
        this.continuation = continuation;
    }

    extend(skeleton: Skeleton): Continuation {
        const path = [];

        function walkNode(node: Node,
                          popCount: number,
                          index: number,
                          skeleton: Skeleton): [number, Node]
        {
            if (skeleton === null) {
                return [popCount, node];
            } else {
                const selector = '' + popCount + ',' + index;
                const cls = skeleton.shape;
                let table = node.edges[selector];
                if (!table) {
                    table = {};
                    node.edges[selector] = table;
                }
                let nextNode = table[cls];
                if (!nextNode) {
                    nextNode = new Node(new Continuation(
                        node.continuation.cachedAssertions.filter(
                            (a) => classOf(projectPath(a, path)) === cls)));
                    table[cls] = nextNode;
                }
                popCount = 0;
                index = 0;
                path.push(index);
                skeleton.members.forEach((member) => {
                    [popCount, nextNode] = walkNode(nextNode, popCount, index, member);
                    index++;
                    path.pop();
                    path.push(index);
                });
                path.pop();
                return [popCount + 1, nextNode];
            }
        }

        return walkNode(this, 0, 0, skeleton)[1].continuation;
    }

    modify(operation: EventType,
           outerValue: Value,
           m_cont: (c: Continuation, v: Value) => void,
           m_leaf: (l: Leaf, v: Value) => void,
           m_handler: (h: Handler, vs: Array<Value>) => void)
    {
        function walkNode(node: Node, termStack: Stack.NonEmptyStack<Array<Value>>) {
            walkContinuation(node.continuation);
            Object.entries(node.edges).forEach(([selectorStr, table]) => {
                const selector = parseSelector(selectorStr);
                let nextStack = Stack.dropNonEmpty(termStack, selector.popCount);
                let nextValue = step(nextStack.item, selector.index);
                let nextNode = table[classOf(nextValue)];
                if (nextNode) walkNode(nextNode, Stack.push(nextValue as Array<Value>, nextStack));
            });
        }

        function walkContinuation(continuation: Continuation) {
            m_cont(continuation, outerValue);
            continuation.leafMap.forEach((constValMap, constPaths) => {
                let constVals = projectPaths(outerValue, constPaths as Array<Path>);
                let leaf = constValMap.get(constVals);
                if (!leaf && operation === EventType.ADDED) {
                    leaf = new Leaf();
                    constValMap.set(constVals, leaf);
                }
                if (leaf) {
                    m_leaf(leaf, outerValue);
                    leaf.handlerMap.forEach((handler, capturePaths) => {
                        m_handler(handler, projectPaths(outerValue, capturePaths as Array<Path>));
                    });
                    if (operation === EventType.REMOVED && leaf.isEmpty()) {
                        constValMap.delete(constVals);
                        if (constValMap.size === 0) {
                            continuation.leafMap.delete(constPaths);
                        }
                    }
                }
                return true;
            });
        }

        walkNode(this, Stack.push([outerValue], Stack.empty()));
    }
}

function parseSelector(s: string): { popCount: number, index: number } {
    const pos = s.indexOf(',');
    return { popCount: parseInt(s.substr(0, pos)),
             index: parseInt(s.substr(pos + 1)) };
}

class Continuation {
    readonly cachedAssertions: Set;
    readonly leafMap: Dictionary<Dictionary<Leaf>> = new Dictionary();

    constructor(cachedAssertions: Set) {
        this.cachedAssertions = cachedAssertions;
    }
}

class Leaf {
    readonly cachedAssertions: Set = new Set();
    readonly handlerMap: Dictionary<Handler> = new Dictionary();

    isEmpty(): boolean {
        return this.cachedAssertions.size === 0 && this.handlerMap.size === 0;
    }
}

class Handler {
    readonly cachedCaptures: Bag;
    readonly callbacks: IdentitySet<HandlerCallback> = new IdentitySet();

    constructor(cachedCaptures: Bag) {
        this.cachedCaptures = cachedCaptures;
    }
}

function classOf(v: any): string | null {
    if (Record.isRecord(v)) {
        const ci = v.getConstructorInfo();
        return _canonicalString(ci.label) + '/' + ci.arity;
    } else if (Array.isArray(v)) {
        return '' + v.length;
    } else {
        return null;
    }
}

function step(v: Array<Value> /* includes Record! */, index: number) {
    return v[index];
}

function projectPath(v: Value, path: Path) {
    for (let index of path) {
        v = step(v as Array<Value>, index);
    }
    return v;
}

function projectPaths(v: Value, paths: Array<Path>) {
  return paths.map((path) => projectPath(v, path));
}

export function analyzeAssertion(a: Value): Analysis {
    const constPaths = [];
    const constVals = [];
    const capturePaths = [];
    const path = [];

    function walk(a: Value): Skeleton {
        if (Capture.isClassOf(a)) {
            // NB. isUnrestricted relies on the specific order that
            // capturePaths is computed here.
            capturePaths.push(path.slice());
            return walk(a[0]);
        }

        if (Discard.isClassOf(a)) {
            return null;
        }

        let cls = classOf(a);
        if (cls !== null) {
            let aa = a as Array<Value>;
            // ^ We know this is safe because it's either Record or Array
            let arity = aa.length;
            let result = { shape: cls, members: [] };
            path.push(0);
            for (let i = 0; i < arity; i++) {
                path[path.length - 1] = i;
                result.members.push(walk(step(aa, i)));
            }
            path.pop();
            return result;
        }

        constPaths.push(path);
        constVals.push(a);
        return null;
    }

    let skeleton = walk(a);

    return { skeleton, constPaths, constVals, capturePaths, assertion: Observe(a) };
}

export function match(p: Value, v: Value): Array<Value> | false {
    const captures = [];

    function walk(p: Value, v: Value): boolean {
        if (Capture.isClassOf(p)) {
            if (!walk(p[0], v)) return false;
            captures.push(v);
            return true;
        }

        if (Discard.isClassOf(p)) return true;

        const pcls = classOf(p);
        const vcls = classOf(v);
        if (pcls !== vcls) return false;

        if (pcls === null) return is(p, v);

        const pp = p as Array<Value>;
        const vv = v as Array<Value>;
        // ^ These are safe because classOf yielded nonnull for both

        return pp.every((pv, i) => walk(pv, vv[i]));
    }

    return walk(p, v) ? captures : false;
}

export function isCompletelyConcrete(p: Value) {
    function walk(p: Value) {
        if (Capture.isClassOf(p)) return false;
        if (Discard.isClassOf(p)) return false;

        const cls = classOf(p);
        if (cls === null) return true;
        return (p as Array<Value>).every(walk);
    }
    return walk(p);
}

export function withoutCaptures(p: Value) {
    function walk(p: Value) {
        if (Capture.isClassOf(p)) return walk(p[0]);
        if (Discard.isClassOf(p)) return p;

        const cls = classOf(p);
        if (cls === null) return p;
        if (Record.isRecord(p)) return new Record(p.label, p.map(walk));
        return (p as Array<Value>).map(walk);
    }
    return walk(p);
}
