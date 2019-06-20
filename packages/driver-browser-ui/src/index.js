//---------------------------------------------------------------------------
// @syndicate-lang/driver-browser-ui, Browser-based UI for Syndicate
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

import { RandomID, Observe, Dataspace } from "@syndicate-lang/core";
const randomId = RandomID.randomId;

import * as P from "./protocol";
export * from "./protocol";

import * as H from "./html";
export * from "./html";

///////////////////////////////////////////////////////////////////////////
// ID allocators

const moduleInstance = randomId(16, true);

let nextFragmentIdNumber = 0;
export function newFragmentId() {
  return 'ui_' + moduleInstance + '_' + (nextFragmentIdNumber++);
}

///////////////////////////////////////////////////////////////////////////

spawn named 'GlobalEventFactory' {
  during Observe(P.GlobalEvent($selector, $eventType, _))
  spawn named ['GlobalEvent', selector, eventType] {
    let sender = Dataspace.wrapExternal((e) => { send P.GlobalEvent(selector, eventType, e); });
    function handler(event) {
      sender(event);
      return dealWithPreventDefault(eventType, event);
    }

    function updateEventListeners(install) {
      selectorMatch(document, selector).forEach(
        eventUpdater(cleanEventType(eventType), handler, install));
    }

    on start updateEventListeners(true);
    on stop updateEventListeners(false);

    on asserted P.UIFragmentVersion($_i, $_v) updateEventListeners(true);
    // TODO: don't be so crude about this ^. On the one hand, this
    // lets us ignore UIFragmentVersion records coming and going; on
    // the other hand, we do potentially a lot of redundant work.
  }
}

///////////////////////////////////////////////////////////////////////////

spawn named 'WindowEventFactory' {
  during Observe(P.WindowEvent($eventType, _))
  spawn named ['WindowEvent', eventType] {
    let sender = Dataspace.wrapExternal((e) => { send P.WindowEvent(eventType, e); });
    let handler = function (event) {
      sender(event);
      return dealWithPreventDefault(eventType, event);
    }

    function updateEventListeners(install) {
      if (install) {
        window.addEventListener(cleanEventType(eventType), handler);
      } else {
        window.removeEventListener(cleanEventType(eventType), handler);
      }
    }

    on start updateEventListeners(true);
    on stop updateEventListeners(false);
  }
}

///////////////////////////////////////////////////////////////////////////

spawn named 'UIFragmentFactory' {
  during P.UIFragment($fragmentId, _, _, _)
  spawn named ['UIFragment', fragmentId] {
    field this.version = 0;

    let selector, html, orderBy;
    let anchorNodes = [];
    let eventRegistrations = {};
    // ^ Map from (Map of selector/eventType) to closure.

    assert P.UIFragmentVersion(fragmentId, this.version) when (this.version > 0);

    on stop removeNodes();

    during Observe(P.UIEvent(fragmentId, $selector, $eventType, _)) {
      on start updateEventListeners({ selector, eventType }, true);
      on stop updateEventListeners({ selector, eventType }, false);
    }

    on asserted P.UIFragment(fragmentId, $newSelector, $newHtml, $newOrderBy) {
      removeNodes();

      selector = newSelector;
      html = newHtml;
      orderBy = newOrderBy;
      anchorNodes = (selector !== null) ? selectorMatch(document, selector) : [];

      if (anchorNodes.length === 0) {
        console.warn('UIFragment found no parent nodes matching selector', selector, fragmentId);
      }

      anchorNodes.forEach((anchorNode) => {
        let insertionPoint = findInsertionPoint(anchorNode, orderBy, fragmentId);
        htmlToNodes(anchorNode, html).forEach((newNode) => {
          setSortKey(newNode, orderBy, fragmentId);
          anchorNode.insertBefore(newNode, insertionPoint);
          configureNode(newNode);
        });
      });

      for (let key in eventRegistrations) {
        updateEventListeners(JSON.parse(key), true); // (re)install event listeners
      }

      this.version++;
    }

    function removeNodes() {
      anchorNodes.forEach((anchorNode) => {
        let insertionPoint = findInsertionPoint(anchorNode, orderBy, fragmentId);
        while (1) {
          let n = insertionPoint ? insertionPoint.previousSibling : anchorNode.lastChild;
          if (!(n && hasSortKey(n, orderBy, fragmentId))) break;
          n.parentNode.removeChild(n); // auto-updates previousSibling/lastChild
        }
      });
    }

    function updateEventListeners(c, install) {
      let key = JSON.stringify(c); // c is of the form { selector: ..., eventType: ... }
      let handlerClosure;

      if (!(key in eventRegistrations)) {
        let sender = Dataspace.wrapExternal((e) => {
          send P.UIEvent(fragmentId, c.selector, c.eventType, e);
        });
        function handler(event) {
          sender(event);
          return dealWithPreventDefault(c.eventType, event);
        }
        eventRegistrations[key] = handler;
        handlerClosure = handler;
      } else {
        handlerClosure = eventRegistrations[key];
      }

      anchorNodes.forEach((anchorNode) => {
        let insertionPoint = findInsertionPoint(anchorNode, orderBy, fragmentId);
        while (1) {
          let uiNode = insertionPoint ? insertionPoint.previousSibling : anchorNode.lastChild;
          if (!(uiNode && hasSortKey(uiNode, orderBy, fragmentId))) break;
          if ('querySelectorAll' in uiNode) {
            selectorMatch(uiNode, c.selector).forEach(
              eventUpdater(cleanEventType(c.eventType), handlerClosure, install));
          }
          insertionPoint = uiNode;
        }
      });

      if (!install) {
        delete eventRegistrations[key];
      }
    }
  }
}

const SYNDICATE_SORT_KEY = '__syndicate_sort_key';

function setSortKey(n, orderBy, fragmentId) {
  let v = JSON.stringify([orderBy, fragmentId]);
  if ('dataset' in n) {
    // html element nodes etc.
    n.dataset[SYNDICATE_SORT_KEY] = v;
  } else {
    // text nodes, svg nodes, etc etc.
    n[SYNDICATE_SORT_KEY] = v;
  }
}

function getSortKey(n) {
  if ('dataset' in n && n.dataset[SYNDICATE_SORT_KEY]) {
    return JSON.parse(n.dataset[SYNDICATE_SORT_KEY]);
  }
  if (n[SYNDICATE_SORT_KEY]) {
    return JSON.parse(n[SYNDICATE_SORT_KEY]);
  }
  return null;
}

function hasSortKey(n, orderBy, fragmentId) {
  let v = getSortKey(n);
  if (!v) return false;
  if (v[0] !== orderBy) return false;
  if (v[1] !== fragmentId) return false;
  return true;
}

function firstChildNodeIndex_withSortKey(n) {
  for (let i = 0; i < n.childNodes.length; i++) {
    if (getSortKey(n.childNodes[i])) return i;
  }
  return n.childNodes.length;
}

// If *no* nodes have a sort key, returns a value that yields an empty
// range in conjunction with firstChildNodeIndex_withSortKey.
function lastChildNodeIndex_withSortKey(n) {
  for (let i = n.childNodes.length - 1; i >= 0; i--) {
    if (getSortKey(n.childNodes[i])) return i;
  }
  return n.childNodes.length - 1;
}

function isGreaterThan(a, b) {
  if (typeof a > typeof b) return true;
  if (typeof a < typeof b) return false;
  return a > b;
}

function findInsertionPoint(n, orderBy, fragmentId) {
  let lo = firstChildNodeIndex_withSortKey(n);
  let hi = lastChildNodeIndex_withSortKey(n) + 1;
  // lo <= hi, and [lo, hi) have sort keys.

  while (lo < hi) { // when lo === hi, there's nothing more to examine.
    let probe = (lo + hi) >> 1;
    let probeSortKey = getSortKey(n.childNodes[probe]);

    if ((isGreaterThan(probeSortKey[0], orderBy))
        || ((probeSortKey[0] === orderBy) && (probeSortKey[1] > fragmentId)))
    {
      hi = probe;
    } else {
      lo = probe + 1;
    }
  }

  // lo === hi now.
  if (lo < n.childNodes.length) {
    return n.childNodes[lo];
  } else {
    return null;
  }
}

function htmlToNodes(parent, html) {
  let e = parent.cloneNode(false);
  e.innerHTML = H.htmlToString(html);
  return Array.prototype.slice.call(e.childNodes);
}

function configureNode(n) {
  // Runs post-insertion configuration of nodes.
  // TODO: review this design.
  selectorMatch(n, '.-syndicate-focus').forEach(function (n) {
    if ('focus' in n && 'setSelectionRange' in n) {
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }
  });
}

///////////////////////////////////////////////////////////////////////////

spawn named 'UIAttributeFactory' {
  during P.UIAttribute($selector, $attribute, $value)
  spawn named ['UIAttribute', selector, attribute, value] {
    _attributeLike.call(this, selector, attribute, value, 'attribute');
  }
}

spawn named 'UIPropertyFactory' {
  during P.UIProperty($selector, $property, $value)
  spawn named ['UIProperty', selector, property, value] {
    _attributeLike.call(this, selector, property, value, 'property');
  }
}

function _attributeLike(selector, key, value, kind) {
  let savedValues = [];
  // ^ Array of {node: DOMNode, value: (U Null String)},
  //   when attribute !== 'class' or kind !== 'attribute'.
  // ^ Array of {node: DOMNode},
  //   when attribute === 'class' and kind === 'attribute'.

  selectorMatch(document, selector).forEach((node) => {
    switch (kind) {
      case 'attribute':
        if (key === 'class') {
          // Deliberately maintains duplicates, so we don't interfere
          // with potential other UIAttribute instances on the same
          // objects for the same attribute. See also
          // restoreSavedValues.
          let existing = splitClassValue(node.getAttribute('class'));
          let toAdd = splitClassValue(value);
          savedValues.push({node: node});
          node.SetAttribute('class', existing.concat(toAdd).join(' '));
        } else {
          savedValues.push({node: node, value: node.getAttribute(key)});
          node.SetAttribute(key, value);
        }
        break;
      case 'property':
        savedValues.push({node: node, value: node[key]});
        node[key] = value;
        break;
    }
  });

  on stop {
    savedValues.forEach((entry) => {
      switch (kind) {
        case 'attribute':
          if (key === 'class') {
            let existing = splitClassValue(entry.node.getAttribute('class'));
            let toRemove = splitClassValue(value);
            toRemove.forEach(function (v) {
              let i = existing.indexOf(v);
              if (i !== -1) { existing.splice(i, 1); }
            });
            if (existing.length === 0) {
              entry.node.RemoveAttribute('class');
            } else {
              entry.node.SetAttribute('class', existing.join(' '));
            }
          } else {
            if (entry.value === null) {
              entry.node.RemoveAttribute(key);
            } else {
              entry.node.SetAttribute(key, entry.value);
            }
          }
          break;
        case 'property':
          if (typeof entry.value === 'undefined') {
            delete entry.node[key];
          } else {
            entry.node[key] = entry.value;
          }
          break;
      }
    });
    savedValues = [];
  }
};

function splitClassValue(v) {
  v = (v || '').trim();
  return v ? v.split(/ +/) : [];
}

///////////////////////////////////////////////////////////////////////////

spawn named 'UIChangeablePropertyFactory' {
  during Observe(P.UIChangeableProperty($selector, $property, _))
  spawn named ['UIChangeableProperty', selector, property] {
    on start selectorMatch(document, selector).forEach((node) => {
      react {
        field this.value = node[property];
        assert P.UIChangeableProperty(selector, property, this.value);
        const handlerClosure = Dataspace.wrapExternal((e) => { this.value = node[property]; });
        on start eventUpdater('change', handlerClosure, true)(node);
        on stop eventUpdater('change', handlerClosure, false)(node);
      }
    });
  }
}

///////////////////////////////////////////////////////////////////////////

function escapeDataAttributeName(s) {
  // Per https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset,
  // the rules seem to be:
  //
  // 1. Must not contain a dash immediately followed by an ASCII lowercase letter
  // 2. Must not contain anything other than:
  //     - letters
  //     - numbers
  //     - dash, dot, colon, underscore
  //
  // I'm not implementing this exactly - I'm escaping some things that
  // don't absolutely need escaping, because it's simpler and I don't
  // yet need to undo this transformation.

  if (typeof s !== 'string') {
    s = JSON.stringify(s);
  }

  let result = '';
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c >= 'a' && c <= 'z') { result = result + c; continue; }
    if (c >= 'A' && c <= 'Z') { result = result + c; continue; }
    if (c >= '0' && c <= '9') { result = result + c; continue; }
    if (c === '.' || c === ':') { result = result + c; continue; }

    c = c.charCodeAt(0);
    result = result + '_' + c + '_';
  }
  return result;
}

function dealWithPreventDefault(eventType, event) {
  let shouldPreventDefault = eventType.charAt(0) !== '+';
  if (shouldPreventDefault) event.preventDefault();
  return !shouldPreventDefault;
}

function cleanEventType(eventType) {
  return (eventType.charAt(0) === '+') ? eventType.slice(1) : eventType;
}

function selectorMatch(n, selector) {
  if (n && typeof n === 'object' && 'querySelectorAll' in n) {
    if (selector === '.') {
      return [n];
    } else {
      return Array.prototype.slice.call(n.querySelectorAll(selector));
    }
  } else {
    return [];
  }
}

function eventUpdater(eventType, handlerClosure, install) {
  return function (n) {
    // addEventListener and removeEventListener are idempotent.
    if (install) {
      n.addEventListener(eventType, handlerClosure);
    } else {
      n.removeEventListener(eventType, handlerClosure);
    }
  };
}

///////////////////////////////////////////////////////////////////////////

export class Anchor {
  constructor(options) {
    options = Object.assign({ fragmentId: void 0 }, options);
    this.fragmentId =
      (typeof options.fragmentId === 'undefined') ? newFragmentId() : options.fragmentId;
  }

  context(...pieces) {
    let extn = pieces.map(escapeDataAttributeName).join('__');
    return new Anchor({ fragmentId: this.fragmentId + '__' + extn });
  }

  html(selector, html, orderBy) {
    return P.UIFragment(this.fragmentId, selector, html, orderBy === void 0 ? null : orderBy);
  }
}

///////////////////////////////////////////////////////////////////////////

spawn named 'LocationHashTracker' {
  field this.hashValue = '/';

  assert P.LocationHash(this.hashValue);

  let handlerClosure = Dataspace.wrapExternal((_e) => loadHash.call(this));

  on start {
    loadHash.call(this);
    window.addEventListener('hashchange', handlerClosure);
  }
  on stop {
    window.removeEventListener('hashchange', handlerClosure);
  }

  on message P.SetLocationHash($newHash) {
    window.location.hash = newHash;
  }

  function loadHash() {
    var h = window.location.hash;
    if (h.length && h[0] === '#') {
      h = h.slice(1);
    }
    this.hashValue = h || '/';
  }
}

///////////////////////////////////////////////////////////////////////////

spawn named 'AttributeUpdater' {
  on message P.SetAttribute($s, $k, $v) update(s, (n) => n.setAttribute(k, v));
  on message P.RemoveAttribute($s, $k) update(s, (n) => n.removeAttribute(k));
  on message P.SetProperty($s, $k, $v) update(s, (n) => { n[k] = v });
  on message P.RemoveProperty($s, $k) update(s, (n) => { delete n[k]; });

  function update(selector, nodeUpdater) {
    selectorMatch(document, selector).forEach(nodeUpdater);
  }
}
