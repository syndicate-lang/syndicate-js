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
const { Record } = require("preserves");

const $Special = require('./special.js');
const Bag = require('./bag.js');
const { Discard, Capture, Observe } = require('./assertions.js');

const EVENT_ADDED = +1;
const EVENT_REMOVED = -1;
const EVENT_MESSAGE = 0;

function Index() {
  this.allAssertions = Bag.Bag();
  this.root = new Node(new Continuation(Immutable.Set()));
}

function Node(continuation) {
  this.continuation = continuation;
  this.edges = Immutable.Map();
}

function Selector(popCount, index) {
  this.popCount = popCount;
  this.index = index;
}

Selector.prototype.equals = function (other) {
  return (this.popCount === other.popCount) && (this.index === other.index);
};

Selector.prototype.hashCode = function () {
  return (this.popCount * 5) + this.index;
};

function Continuation(cachedAssertions) {
  this.cachedAssertions = cachedAssertions;
  this.leafMap = Immutable.Map();
}

function Leaf(cachedAssertions) {
  this.cachedAssertions = cachedAssertions;
  this.handlerMap = Immutable.Map();
}

function Handler(cachedCaptures) {
  this.cachedCaptures = cachedCaptures;
  this.callbacks = Immutable.Set();
}

function classOf(v) {
  if (v instanceof Record) {
    return v.getConstructorInfo();
  } else if (Immutable.List.isList(v)) {
    return v.size;
  } else {
    return null;
  }
}

function step(v, index) {
  return v.get(index);
}

function projectPath(v, path) {
  path.forEach((index) => { v = step(v, index); return true; });
  return v;
}

function projectPaths(v, paths) {
  return paths.map((path) => projectPath(v, path));
}

Node.prototype.extend = function(skeleton) {
  function walkNode(path, node, popCount, index, skeleton) {
    if (skeleton === null) {
      return [popCount, node];
    } else {
      let selector = new Selector(popCount, index);
      let cls = skeleton[0];
      let table = node.edges.get(selector, false);
      if (!table) {
        table = Immutable.Map();
        node.edges = node.edges.set(selector, table);
      }
      let nextNode = table.get(cls, false);
      if (!nextNode) {
        nextNode = new Node(new Continuation(
          node.continuation.cachedAssertions.filter(
            (a) => Immutable.is(classOf(projectPath(unscope(a), path)), cls))));
        table = table.set(cls, nextNode);
        node.edges = node.edges.set(selector, table);
      }

      popCount = 0;
      index = 0;
      path = path.push(index);
      for (let i = 1; i < skeleton.length; i++) {
        [popCount, nextNode] = walkNode(path, nextNode, popCount, index, skeleton[i]);
        index++;
        path = path.pop().push(index);
      }
      return [popCount + 1, nextNode];
    }
  }

  let [_popCount, finalNode] = walkNode(Immutable.List(), this, 0, 0, skeleton);
  return finalNode.continuation;
};

Index.prototype.addHandler = function(analysisResults, callback) {
  let {skeleton, constPaths, constVals, capturePaths} = analysisResults;
  let continuation = this.root.extend(skeleton);
  let constValMap = continuation.leafMap.get(constPaths, false);
  if (!constValMap) {
    constValMap = Immutable.Map();
    continuation.leafMap = continuation.leafMap.set(constPaths, constValMap);
  }
  let leaf = constValMap.get(constVals, false);
  if (!leaf) {
    leaf = new Leaf(continuation.cachedAssertions.filter(
      (a) => projectPaths(unscope(a), constPaths).equals(constVals)));
    constValMap = constValMap.set(constVals, leaf);
    continuation.leafMap = continuation.leafMap.set(constPaths, constValMap);
  }
  let handler = leaf.handlerMap.get(capturePaths, false);
  if (!handler) {
    let cachedCaptures = Bag.Bag().withMutations((mutable) => {
      leaf.cachedAssertions.forEach((a) => {
        return unpackScoped(a, (restrictionPaths, term) => {
          if (restrictionPaths === false || restrictionPaths.equals(capturePaths)) {
            let captures = projectPaths(term, capturePaths);
            mutable.set(captures, mutable.get(captures, 0) + 1);
          }
          return true;
        });
      })
    });
    handler = new Handler(cachedCaptures);
    leaf.handlerMap = leaf.handlerMap.set(capturePaths, handler);
  }
  handler.callbacks = handler.callbacks.add(callback);
  handler.cachedCaptures.forEach((_count, captures) => {
    callback(EVENT_ADDED, captures);
    return true;
  });
};

Index.prototype.removeHandler = function(analysisResults, callback) {
  let {skeleton, constPaths, constVals, capturePaths} = analysisResults;
  let continuation = this.root.extend(skeleton);
  let constValMap = continuation.leafMap.get(constPaths, false);
  if (!constValMap) return;
  let leaf = constValMap.get(constVals, false);
  if (!leaf) return;
  let handler = leaf.handlerMap.get(capturePaths, false);
  if (!handler) return;
  handler.callbacks = handler.callbacks.remove(callback);
  if (handler.callbacks.isEmpty()) {
    leaf.handlerMap = leaf.handlerMap.remove(capturePaths);
  }
  if (leaf.handlerMap.isEmpty()) {
    constValMap = constValMap.remove(constVals);
  }
  if (constValMap.isEmpty()) {
    continuation.leafMap = continuation.leafMap.remove(constPaths);
  } else {
    continuation.leafMap = continuation.leafMap.set(constPaths, constValMap);
  }
};

Node.prototype.modify = function(outerValue, m_cont, m_leaf, m_handler) {
  const [restrictionPaths, outerValueTerm] = unpackScoped(outerValue, (p,t) => [p,t]);

  function walkNode(node, termStack) {
    walkContinuation(node.continuation);
    node.edges.forEach((table, selector) => {
      let nextStack = termStack.withMutations((mutable) => {
        let i = selector.popCount;
        while (i--) { mutable.pop(); }
      });
      let nextValue = step(nextStack.first(), selector.index);
      let nextNode = table.get(classOf(nextValue), false);
      if (nextNode) {
        walkNode(nextNode, nextStack.push(nextValue));
      }
      return true;
    });
  }

  function walkContinuation(continuation) {
    m_cont(continuation, outerValue);
    continuation.leafMap.forEach((constValMap, constPaths) => {
      let constVals = projectPaths(outerValueTerm, constPaths);
      let leaf = constValMap.get(constVals, false);
      if (leaf) {
        m_leaf(leaf, outerValue);
        leaf.handlerMap.forEach((handler, capturePaths) => {
          if (restrictionPaths === false || restrictionPaths.equals(capturePaths)) {
            m_handler(handler, projectPaths(outerValueTerm, capturePaths));
          }
          return true;
        });
      }
      return true;
    });
  }

  walkNode(this, Immutable.Stack().push(Immutable.List([outerValueTerm])));
};

function add_to_cont(c, v) { c.cachedAssertions = c.cachedAssertions.add(v); }
function add_to_leaf(l, v) { l.cachedAssertions = l.cachedAssertions.add(v); }
function add_to_handler(h, vs) {
  let net;
  ({bag: h.cachedCaptures, net: net} = Bag.change(h.cachedCaptures, vs, +1));
  if (net === Bag.ABSENT_TO_PRESENT) {
    h.callbacks.forEach((cb) => {
      cb(EVENT_ADDED, vs);
      return true;
    });
  }
}

function del_from_cont(c, v) { c.cachedAssertions = c.cachedAssertions.remove(v); }
function del_from_leaf(l, v) { l.cachedAssertions = l.cachedAssertions.remove(v); }
function del_from_handler(h, vs) {
  let net;
  ({bag: h.cachedCaptures, net: net} = Bag.change(h.cachedCaptures, vs, -1));
  if (net === Bag.PRESENT_TO_ABSENT) {
    h.callbacks.forEach((cb) => {
      cb(EVENT_REMOVED, vs);
      return true;
    });
  }
}

Index.prototype.adjustAssertion = function(outerValue, delta) {
  let net;
  ({bag: this.allAssertions, net: net} = Bag.change(this.allAssertions, outerValue, delta));
  switch (net) {
    case Bag.ABSENT_TO_PRESENT:
      this.root.modify(outerValue, add_to_cont, add_to_leaf, add_to_handler);
      break;
    case Bag.PRESENT_TO_ABSENT:
      this.root.modify(outerValue, del_from_cont, del_from_leaf, del_from_handler);
      break;
  }
  return net;
};

Index.prototype.addAssertion = function(v) { this.adjustAssertion(v, +1); };
Index.prototype.removeAssertion = function (v) { this.adjustAssertion(v, -1); };

const _nop = () => {};
Index.prototype.sendMessage = function(v, leafCallback) {
  this.root.modify(v, _nop, leafCallback || _nop, (h, vs) => {
    h.callbacks.forEach((cb) => {
      cb(EVENT_MESSAGE, vs);
      return true;
    });
  });
};

Node.prototype._debugString = function (outerIndent) {
  const pieces = [];
  const inspect = require('util').inspect;
  function line(indent, content) {
    pieces.push(indent);
    pieces.push(content);
  }
  function walkNode(indent, n) {
    line(indent, '  Continuation:');
    walkContinuation(indent+'    ', n.continuation);
    if (!n.edges.isEmpty()) line(indent, '  Edges:');
    n.edges.forEach((table, selector) => {
      line(indent+'    ', `pop ${selector.popCount} index ${selector.index}`);
      table.forEach((nextNode, cls) => {
        line(indent+'      ', inspect(cls));
        walkNode(indent+'      ', nextNode);
      });
    });
  }
  function walkCache(indent, cache) {
    if (!cache.isEmpty()) line(indent, 'Cache:')
    cache.forEach((v,k) => {
      line(indent+'  ', (k ? k.toString() + ': ' : '') + v && v.toString());
    });
  }
  function walkContinuation(indent, c) {
    walkCache(indent, c.cachedAssertions);
    c.leafMap.forEach((constValMap, constPaths) => {
      line(indent, constPaths.toString() + ' =?= ...');
      constValMap.forEach((leaf, constVals) => {
        line(indent+'  ', constVals.toString());
        walkLeaf(indent+'    ', leaf);
      });
    });
  }
  function walkLeaf(indent, l) {
    walkCache(indent, l.cachedAssertions);
    l.handlerMap.forEach((handler, capturePaths) => {
      line(indent, capturePaths.toString() + ' ==> ...');
      walkHandler(indent+'  ', handler);
    });
  }
  function walkHandler(indent, h) {
    walkCache(indent, h.cachedCaptures);
    line(indent, '' + h.callbacks.size + ' callback(s)');
  }
  line(outerIndent || '', 'INDEX ROOT');
  walkNode(outerIndent || '\n', this);
  return pieces.join('');
};

///////////////////////////////////////////////////////////////////////////

function analyzeAssertion(a) {
  let constPaths = Immutable.List();
  let constVals = Immutable.List();
  let capturePaths = Immutable.List();

  function walk(path, a) {
    if (Capture.isClassOf(a)) {
      capturePaths = capturePaths.push(path);
      return walk(path, a.get(0));
    }

    if (Discard.isClassOf(a)) {
      return null;
    }

    let cls = classOf(a);
    if (cls !== null) {
      let arity = (typeof cls === 'number') ? cls : cls.arity;
      let result = [cls];
      for (let i = 0; i < arity; i++) {
        result.push(walk(path.push(i), step(a, i)));
      }
      return result;
    }

    constPaths = constPaths.push(path);
    constVals = constVals.push(a);
    return null;
  }

  let skeleton = walk(Immutable.List(), a);

  return { skeleton, constPaths, constVals, capturePaths, assertion: Observe(a) };
}

function OpaquePlaceholder() {}

function instantiateAssertion(a, vs) {
  let capturePaths = Immutable.List();
  let remaining = vs;

  function walk(path, a) {
    if (Capture.isClassOf(a)) {
      capturePaths = capturePaths.push(path);
      const v = remaining.first();
      remaining = remaining.shift();
      walk(path, a.get(0));
      return v;
    }

    if (Discard.isClassOf(a)) {
      return new OpaquePlaceholder();
      // ^ Doesn't match ANYTHING ELSE, even other `OpaquePlaceholder`
      // instances. This prevents unwanted matching against
      // "don't-care" positions when `VisibilityRestriction`s are in
      // play.
    }

    let cls = classOf(a);
    if (cls !== null) {
      if (typeof cls === 'number') {
        return a.map((v, i) => walk(path.push(i), v));
      } else {
        return new Record(a.label, a.fields.map((v, i) => walk(path.push(i), v)));
      }
    }

    return a;
  }

  const instantiated = walk(Immutable.List(), a);
  // ^ Compute `instantiated` completely before retrieving the imperatively-updated `capturePaths`.
  return new VisibilityRestriction(capturePaths, instantiated);
}

function VisibilityRestriction(paths, term) {
  this.paths = paths;
  this.term = term;
}

VisibilityRestriction.prototype.toString = function () {
  return "VisibilityRestriction(" + this.paths.toString() + "," + this.term.toString() + ")";
};

function unscope(a) {
  return (a instanceof VisibilityRestriction) ? a.term : a;
}

function unpackScoped(a, k) {
  return (a instanceof VisibilityRestriction) ? k(a.paths, a.term) : k(false, a);
}

///////////////////////////////////////////////////////////////////////////

function match(p, v) {
  let captures = Immutable.List();

  function walk(p, v) {
    if (Capture.isClassOf(p)) {
      if (!walk(p.get(0), v)) return false;
      captures = captures.push(v);
      return true;
    }

    if (Discard.isClassOf(p)) return true;

    const pcls = classOf(p);
    const vcls = classOf(v);
    if (!Immutable.is(pcls, vcls)) return false;

    if (pcls === null) return Immutable.is(p, v);
    if (typeof pcls === 'number') return p.every((pv, i) => walk(pv, v.get(i)));
    return p.fields.every((pv, i) => walk(pv, v.fields.get(i)));
  }

  return walk(p, v) ? captures : false;
}

function isCompletelyConcrete(p) {
  function walk(p) {
    if (Capture.isClassOf(p)) return false;
    if (Discard.isClassOf(p)) return false;

    const cls = classOf(p);
    if (cls === null) return true;
    if (typeof cls === 'number') return p.every(walk);
    return p.fields.every(walk);
  }
  return walk(p);
}

function withoutCaptures(p) {
  function walk(p) {
    if (Capture.isClassOf(p)) return walk(p.get(0));
    if (Discard.isClassOf(p)) return p;

    const cls = classOf(p);
    if (cls === null) return p;
    if (typeof cls === 'number') return p.map(walk);
    return new Record(p.label, p.fields.map(walk));
  }
  return walk(p);
}

///////////////////////////////////////////////////////////////////////////

module.exports.EVENT_ADDED = EVENT_ADDED;
module.exports.EVENT_REMOVED = EVENT_REMOVED;
module.exports.EVENT_MESSAGE = EVENT_MESSAGE;
module.exports.Index = Index;

module.exports.analyzeAssertion = analyzeAssertion;
module.exports.instantiateAssertion = instantiateAssertion;
module.exports.match = match;
module.exports.isCompletelyConcrete = isCompletelyConcrete;
module.exports.withoutCaptures = withoutCaptures;
