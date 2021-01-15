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

import { Value, Record } from 'preserves';

import { $Special } from './special.js';
import { Dataspace, Facet, Actor, Endpoint, Script } from './dataspace.js';
import { Observe, Inbound, Outbound } from './assertions.js';
import { ChangeDescription } from './bag.js';
import { EventType, Analysis } from './skeleton.js';
import { Ground } from './ground.js';

export const $QuitDataspace = new $Special("quit-dataspace");

export class NestedDataspace extends Dataspace {
    readonly outerFacet: Facet;

    constructor(outerFacet: Facet, bootProc: Script<void>) {
        super(bootProc);
        this.outerFacet = outerFacet;
    }

    deliverMessage(m: any, _sendingActor: Actor) {
        super.deliverMessage(m, _sendingActor);
        if (m === $QuitDataspace) {
            this.outerFacet.stop();
        }
    }

    endpointHook(facet: Facet, innerEp: Endpoint) {
        super.endpointHook(facet, innerEp);

        const innerAssertion = innerEp.spec.assertion;
        if (!Observe.isClassOf(innerAssertion)) return;
        const wrapper = innerAssertion[0];
        if (!Inbound.isClassOf(wrapper)) return;

        // We know that innerAssertion is an Observe(Inbound(...)). Also, if
        // innerEp.spec.analysis exists, it will be consonant with innerAssertion. Beware of
        // completely-constant patterns, which cause skeleton to be null!

        const innerDs = this;
        this.hookEndpointLifecycle(innerEp, this.outerFacet.addEndpoint(() => {
            const assertion = Observe(wrapper[0]);
            const h = innerEp.spec.analysis!;
            const innerCallback = h.callback;
            const callback = (innerCallback === void 0) ? void 0 :
                function (evt: EventType, captures: Array<Value>) {
                    innerCallback.call(null, evt, captures);
                    innerDs.start();
                };
            const analysis: Analysis | null = (h === null) ? null :
                (h.skeleton === null
                    ? {
                        skeleton: null,
                        constPaths: h.constPaths,
                        constVals: h.constVals.map(v => (v as Record)[0]),
                        capturePaths: h.capturePaths.map(p => p.slice(1)),
                        assertion,
                        callback
                    }
                    : {
                        skeleton: h.skeleton.members[0],
                        constPaths: h.constPaths.map(p => p.slice(1)),
                        constVals: h.constVals,
                        capturePaths: h.capturePaths.map(p => p.slice(1)),
                        assertion,
                        callback
                    });
            return { assertion, analysis };
        }, false));
    }

    adjustIndex(a: Value, count: number) {
        const net = super.adjustIndex(a, count);
        if (Outbound.isClassOf(a)) {
            switch (net) {
                case ChangeDescription.ABSENT_TO_PRESENT:
                    this.outerFacet.actor.scheduleTask(() => {
                        this.outerFacet.actor.adhocAssert(a[0]);
                    });
                    this.outerFacet.actor.dataspace.start();
                    break;
                case ChangeDescription.PRESENT_TO_ABSENT:
                    this.outerFacet.actor.scheduleTask(() => {
                        this.outerFacet.actor.adhocRetract(a[0]);
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
        this.outerFacet.scheduleScript(outerFacet => {
            outerFacet.invokeScript(() => {
                if (this.outerFacet.isLive) {
                    this.outerFacet.deferTurn(() => {
                        const stillBusy = this.runTasks();
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

export function inNestedDataspace(bootProc: Script<void>): Script<void> {
    return outerFacet => {
        outerFacet.addDataflow(function () {});
        // ^ eww! Dummy endpoint to keep the root facet of the relay alive.
        const innerDs = new NestedDataspace(outerFacet, innerFacet =>
            innerFacet.addStartScript(f => bootProc.call(f.fields, f)));
        innerDs.start();
    };
}
