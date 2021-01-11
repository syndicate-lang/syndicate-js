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

import { Value } from 'preserves';

import { $Special } from './special.js';
import { Dataspace, Facet, Actor, Endpoint, Script } from './dataspace.js';
import { Observe, Inbound, Outbound } from './assertions.js';
import { ChangeDescription } from './bag.js';
import { EventType, Analysis } from './skeleton.js';
import { Ground } from './ground.js';

export const $QuitDataspace = new $Special("quit-dataspace");

export class NestedDataspace extends Dataspace {
    readonly outerFacet: Facet;

    constructor(outerFacet: Facet, bootProc: Script) {
        super(bootProc);
        this.outerFacet = outerFacet;
    }

    sendMessage(m: any, _sendingActor: Actor) {
        super.sendMessage(m, _sendingActor);
        if (m === $QuitDataspace) {
            this.outerFacet.stop();
        }
    }

    endpointHook(facet: Facet, innerEp: Endpoint) {
        const innerDs = this;
        super.endpointHook(facet, innerEp);
        if (Observe.isClassOf(innerEp.spec.assertion) &&
            Inbound.isClassOf(innerEp.spec.assertion[0]))
        {
            // We know that innerEp.spec.assertion is an Observe(Inbound(...)). Also, if
            // innerEp.spec.analysis exists, it will be consonant with innerEp.spec.assertion.
            // Beware of completely-constant patterns, which cause skeleton to be null!
            this.hookEndpointLifecycle(innerEp, this.outerFacet.addEndpoint(() => {
                const assertion = Observe(innerEp.spec.assertion[0][0]);
                const h = innerEp.spec.analysis;
                const innerCallback = h.callback;
                const callback = (innerCallback === void 0) ? void 0 :
                    function (evt: EventType, captures: Array<Value>) {
                        innerCallback.call(this, evt, captures);
                        innerDs.start();
                    };
                const analysis: Analysis | null = (h === null) ? null :
                    (h.skeleton === void 0
                        ? {
                            skeleton: void 0,
                            constPaths: h.constPaths,
                            constVals: h.constVals.map((v) => v[0]),
                            capturePaths: h.capturePaths.map((p) => p.slice(1)),
                            assertion,
                            callback
                        }
                        : {
                            skeleton: h.skeleton[1],
                            constPaths: h.constPaths.map((p) => p.slice(1)),
                            constVals: h.constVals,
                            capturePaths: h.capturePaths.map((p) => p.slice(1)),
                            assertion,
                            callback
                        });
                return { assertion, analysis };
            }, false));
        }
    }

    adjustIndex(a: Value, count: number) {
        const net = super.adjustIndex(a, count);
        if (Outbound.isClassOf(a)) {
            switch (net) {
                case ChangeDescription.ABSENT_TO_PRESENT:
                    this.outerFacet.actor.pushScript(() => {
                        this.outerFacet.actor.adhocAssert(a.get(0));
                    });
                    this.outerFacet.actor.dataspace.start();
                    break;
                case ChangeDescription.PRESENT_TO_ABSENT:
                    this.outerFacet.actor.pushScript(() => {
                        this.outerFacet.actor.adhocRetract(a.get(0));
                    });
                    this.outerFacet.actor.dataspace.start();
                    break;
            }
        }
        return net;
    }

    hookEndpointLifecycle(innerEp: Endpoint, outerEp: Endpoint) {
        const _refresh = innerEp.refresh;
        innerEp.refresh = function () {
            _refresh.call(this);
            outerEp.refresh();
        };

        const _destroy = innerEp.destroy;
        innerEp.destroy = function (emitPatches: boolean) {
            _destroy.call(this, emitPatches);
            outerEp.destroy(true);
        };
    }

    start(): this {
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
    }

    ground(): Ground {
        return this.outerFacet.actor.dataspace.ground();
    }
}

export function inNestedDataspace(bootProc: Script): Script {
    return () => {
        const outerFacet = Dataspace.currentFacet;
        outerFacet.addDataflow(function () {});
        // ^ eww! Dummy endpoint to keep the root facet of the relay alive.
        const innerDs = new NestedDataspace(outerFacet, function () {
            Dataspace.currentFacet.addStartScript(() => bootProc.call(this));
        });
        innerDs.start();
    };
}
