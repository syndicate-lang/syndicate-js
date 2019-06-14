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

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                require('path').basename(module.filename),
                                                module)) return;

const $Special = require('./special.js');

const _Dataspace = require('./dataspace.js');
const Dataspace = _Dataspace.Dataspace;

const Assertions = require('./assertions.js');
const Observe = Assertions.Observe;
const Inbound = Assertions.Inbound;
const Outbound = Assertions.Outbound;

const Bag = require('./bag.js');

const $QuitDataspace = new $Special("quit-dataspace");

function NestedDataspace(outerFacet, bootProc) {
  Dataspace.call(this, bootProc);
  this.outerFacet = outerFacet;
}
NestedDataspace.prototype = new Dataspace(null);

NestedDataspace.prototype.sendMessage = function (m) {
  Dataspace.prototype.sendMessage.call(this, m);
  if (m === $QuitDataspace) {
    this.outerFacet.stop();
  }
};

NestedDataspace.prototype.endpointHook = function (facet, innerEp) {
  const innerDs = this;
  Dataspace.prototype.endpointHook.call(this, facet, innerEp);
  if (Observe.isClassOf(innerEp.assertion) && Inbound.isClassOf(innerEp.assertion.get(0))) {
    // We know that innerEp.assertion is an Observe(Inbound(...)).
    // Also, if innerEp.handler exists, it will be consonant with innerEp.assertion.
    // Beware of completely-constant patterns, which cause skeleton to be null!
    this.hookEndpointLifecycle(innerEp, this.outerFacet.addEndpoint(() => {
      const h = innerEp.handler;
      return [Observe(innerEp.assertion.get(0).get(0)),
              h && (h.skeleton === null
                    ? {
                      skeleton: null,
                      constPaths: h.constPaths,
                      constVals: h.constVals.map((v) => v.get(0)),
                      capturePaths: h.capturePaths.map((p) => p.shift()),
                      callback: function (evt, captures) {
                        h.callback.call(this, evt, captures);
                        innerDs.start();
                      }
                    }
                    : {
                      skeleton: h.skeleton[1],
                      constPaths: h.constPaths.map((p) => p.shift()),
                      constVals: h.constVals,
                      capturePaths: h.capturePaths.map((p) => p.shift()),
                      callback: function (evt, captures) {
                        h.callback.call(this, evt, captures);
                        innerDs.start();
                      }
                    })];
    }, false));
  }
};

NestedDataspace.prototype.adjustIndex = function (a, count) {
  const net = Dataspace.prototype.adjustIndex.call(this, a, count);
  if (Outbound.isClassOf(a)) {
    switch (net) {
      case Bag.ABSENT_TO_PRESENT:
        this.outerFacet.actor.pushScript(() => {
          this.outerFacet.actor.adhocAssert(a.get(0));
        });
        this.outerFacet.actor.dataspace.start();
        break;
      case Bag.PRESENT_TO_ABSENT:
        this.outerFacet.actor.pushScript(() => {
          this.outerFacet.actor.adhocRetract(a.get(0));
        });
        this.outerFacet.actor.dataspace.start();
        break;
    }
  }
  return net;
};

NestedDataspace.prototype.hookEndpointLifecycle = function (innerEp, outerEp) {
  const outerFacet = this.outerFacet;

  const _refresh = innerEp.refresh;
  innerEp.refresh = function (ds, ac, facet) {
    _refresh.call(this, ds, ac, facet);
    outerEp.refresh(outerFacet.actor.dataspace, outerFacet.actor, outerFacet);
  };

  const _destroy = innerEp.destroy;
  innerEp.destroy = function (ds, ac, facet, emitPatches) {
    _destroy.call(this, ds, ac, facet, emitPatches);
    outerEp.destroy(outerFacet.actor.dataspace, outerFacet.actor, outerFacet, true);
  };
};

NestedDataspace.prototype.start = function () {
  this.outerFacet.actor.dataspace.start();
  this.outerFacet.actor.pushScript(() => {
    Dataspace.withCurrentFacet(this.outerFacet, () => {
      if (this.outerFacet.isLive) {
        Dataspace.deferTurn(() => {
          const stillBusy = this.runScripts();
          if (stillBusy) this.start();
        });
      }
    });
  });
  return this;
};

NestedDataspace.prototype.ground = function () {
  return this.outerFacet.actor.dataspace.ground();
};

function inNestedDataspace(bootProc) {
  return () => {
    const outerFacet = Dataspace.currentFacet();
    outerFacet.addDataflow(function () {});
    // ^ eww! Dummy endpoint to keep the root facet of the relay alive.
    const innerDs = new NestedDataspace(outerFacet, function () {
      Dataspace.currentFacet().addStartScript(() => bootProc.call(this));
    });
    innerDs.start();
  };
}

module.exports.$QuitDataspace = $QuitDataspace;
module.exports.NestedDataspace = NestedDataspace;
module.exports.inNestedDataspace = inNestedDataspace;
