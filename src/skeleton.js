"use strict";

const Immutable = require("immutable");
const Struct = require('./struct.js');
const $Special = require('./special.js');
const Bag = require('./bag.js');
const Assertions = require('./assertions.js');

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

function projectPath(v, path) {
  path.forEach((index) => { v = v.get(index); return true; });
  return v;
}

function projectPaths(v, paths) {
  return paths.map((path) => { return projectPath(v, path) });
}

function classOf(v) {
  if (v instanceof Struct.Structure) {
    return v.meta;
  } else {
    return v.size;
  }
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
          node.continuation.cachedAssertions.filter((a) => {
            return classOf(project(a, path)) === cls;
          })));
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

Index.prototype.addHandler = function(skeleton, constPaths, constVals, capturePaths, callback) {
  let continuation = this.root.extend(skeleton);
  let constValMap = continuation.leafMap.get(constPaths, false);
  if (!constValMap) {
    constValMap = Immutable.Map();
    continuation.leafMap = continuation.leafMap.set(constPaths, constValMap);
  }
  let leaf = constValMap.get(constVals, false);
  if (!leaf) {
    leaf = new Leaf(continuation.cachedAssertions.filter((a) => {
      return projectPaths(a, constPaths).equals(constVals);
    }));
    constValMap = constValMap.set(constVals, leaf);
    continuation.leafMap = continuation.leafMap.set(constPaths, constValMap);
  }
  let handler = leaf.handlerMap.get(capturePaths, false);
  if (!handler) {
    let cachedCaptures = Bag.Bag().withMutations((mutable) => {
      leaf.cachedAssertions.forEach((a) => {
        let captures = projectPaths(a, capturePaths);
        mutable.set(captures, mutable.get(captures, 0) + 1);
        return true;
      })
    });
    handler = new Handler(cachedCaptures);
    leaf.handlerMap = leaf.handlerMap.set(capturePaths, handler);
  }
  handler.callbacks = handler.callbacks.add(callback);
  handler.cachedCaptures.forEach((captures) => {
    callback(EVENT_ADDED, captures);
    return true;
  });
};

Index.prototype.removeHandler = function(skeleton, constPaths, constVals, capturePaths, callback) {
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
    continuation.leafMap.remove(constPaths);
  } else {
    continuation.leafMap.set(constPaths, constValMap);
  }
};

Node.prototype.modify = function(outerValue, m_cont, m_leaf, m_handler) {
  function walkNode(node, termStack) {
    walkContinuation(node.continuation);
    node.edges.forEach((table, selector) => {
      let nextStack = termStack.withMutations((mutable) => {
        let i = selector.popCount;
        while (i--) { mutable.pop(); }
      });
      let nextValue = nextStack.first().get(selector.index);
      let cls = classOf(nextValue);
      let nextNode = table.get(cls, false);
      if (nextNode) {
        walkNode(nextNode, nextStack.push(nextValue));
      }
      return true;
    });
  }

  function walkContinuation(continuation) {
    m_cont(continuation, outerValue);
    continuation.leafMap.forEach((constValMap, constPaths) => {
      let constVals = projectPaths(outerValue, constPaths);
      let leaf = constValMap.get(constVals, false);
      if (leaf) {
        m_leaf(leaf, outerValue);
        leaf.handlerMap.forEach((handler, capturePaths) => {
          m_handler(handler, projectPaths(outerValue, capturePaths));
          return true;
        });
      }
      return true;
    });
  }

  walkNode(this, Immutable.Stack().push(Immutable.List([outerValue])));
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
};

Index.prototype.addAssertion = function(v) { this.adjustAssertion(v, +1); };
Index.prototype.removeAssertion = function (v) { this.adjustAssertion(v, -1); };

Index.prototype.sendMessage = function(v) {
  this.root.modify(v, ()=>{}, ()=>{}, (h, vs) => {
    h.callbacks.forEach((cb) => {
      cb(EVENT_MESSAGE, vs);
      return true;
    });
  });
};

///////////////////////////////////////////////////////////////////////////

module.exports.EVENT_ADDED = EVENT_ADDED;
module.exports.EVENT_REMOVED = EVENT_REMOVED;
module.exports.EVENT_MESSAGE = EVENT_MESSAGE;
module.exports.Index = Index;
