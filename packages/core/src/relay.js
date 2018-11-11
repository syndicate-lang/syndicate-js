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

const $Special = require('./special.js');

const _Dataspace = require('./dataspace.js');
const Dataspace = _Dataspace.Dataspace;

const Assertions = require('./assertions.js');
const Observe = Assertions.Observe;
const Inbound = Assertions.Inbound;
const Outbound = Assertions.Outbound;

const $QuitDataspace = new $Special("quit-dataspace");

// TODO: container --> metaContainer == ground
// TODO: parent links
// so there's a path up the tree at all times, and also an easy way to get to ground

function NestedDataspace(outerFacet, container, bootProc) {
  Dataspace.call(this, container, bootProc);
  this.outerFacet = outerFacet;
}
NestedDataspace.prototype = new Dataspace(null, null);

NestedDataspace.prototype.sendMessage = function (m) {
  Dataspace.prototype.sendMessage.call(this, m);
  if (m === $QuitDataspace) {
    this.outerFacet.stop();
  }
};

NestedDataspace.prototype.endpointHook = function (facet, ep) {
  Dataspace.prototype.endpointHook.call(this, facet, ep);
  if (Observe.isClassOf(ep.assertion) && Inbound.isClassOf(ep.assertion[0])) {
    this.installInboundRelay(facet, ep);
  } else if (Outbound.isClassOf(ep.assertion)) {
    this.installOutboundRelay(facet, ep);
  }
};

NestedDataspace.prototype.installInboundRelay = function (facet, innerEp) {
  // We know that innerEp.assertion is an Observe(Inbound(...)).
  // Also, if innerEp.handler exists, it will be consonant with innerEp.assertion.
  this.hookEndpointLifecycle(innerEp, this.outerFacet.addEndpoint(() => {
    return [Observe(innerEp.assertion[0][0]),
            innerEp.handler && {
              skeleton: innerEp.handler.skeleton[1],
              constPaths: innerEp.handler.constPaths.map((p) => p.shift()),
              constVals: innerEp.handler.constVals,
              capturePaths: innerEp.handler.capturePaths.map((p) => p.shift()),
              callback: innerEp.handler.callback
            }];
  }, false));
};

NestedDataspace.prototype.installOutboundRelay = function (facet, innerEp) {
  // We know that innerEp.assertion is an Outbound(...).
  // We may also then conclude that there is no point in installing a handler.
  this.hookEndpointLifecycle(innerEp, this.outerFacet.addEndpoint(() => {
    return [innerEp.assertion[0], null];
  }, false));
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
};

function inNestedDataspace(bootProc) {
  return () => {
    const outerFacet = Dataspace.currentFacet();
    outerFacet.addDataflow(function () {});
    // ^ eww! Dummy endpoint to keep the root facet of the relay alive.
    const innerDs = new NestedDataspace(outerFacet, outerFacet.actor.dataspace.container, bootProc);
    outerFacet.actor.scheduleScript(() => innerDs.start());
  };
}

module.exports.$QuitDataspace = $QuitDataspace;
module.exports.NestedDataspace = NestedDataspace;
module.exports.inNestedDataspace = inNestedDataspace;
