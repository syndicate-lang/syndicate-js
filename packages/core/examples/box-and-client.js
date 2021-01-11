#!/usr/bin/env -S node --es-module-specifier-resolution=node
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

import { Dataspace, Skeleton, Ground, Record, Discard, Capture, Observe } from '../lib/index';
const __ = Discard._instance;
const _$ = Capture(__);

const BoxState = Record.makeConstructor('BoxState', ['value']);
const SetBox = Record.makeConstructor('SetBox', ['newValue']);

const N = 100000;

console.time('box-and-client-' + N.toString());

new Ground(() => {
    Dataspace.spawn('box', function () {
        Dataspace.declareField(this, 'value', 0);
        Dataspace.currentFacet.addEndpoint(() => {
            return { assertion: BoxState(this.value), analysis: null };
        });
        Dataspace.currentFacet.addDataflow(() => {
            console.log('dataflow saw new value', this.value);
            if (this.value === N) {
                Dataspace.currentFacet.stop(() => {
                    console.log('terminated box root facet');
                });
            }
        });
        Dataspace.currentFacet.addEndpoint(() => {
            let analysis = Skeleton.analyzeAssertion(SetBox(_$));
            analysis.callback = Dataspace.wrap((evt, vs) => {
                if (evt === Skeleton.EventType.MESSAGE) {
                    Dataspace.currentFacet.actor.scheduleScript(() => {
                        this.value = vs[0];
                        console.log('box updated value', vs[0]);
                    });
                }
            });
            return { assertion: Observe(SetBox(_$)), analysis };
        });
    });

    Dataspace.spawn('client', function () {
        Dataspace.currentFacet.addEndpoint(() => {
            let analysis = Skeleton.analyzeAssertion(BoxState(_$));
            analysis.callback = Dataspace.wrap((evt, vs) => {
                if (evt === Skeleton.EventType.ADDED) {
                    Dataspace.currentFacet.actor.scheduleScript(() => {
                        console.log('client sending SetBox', vs[0] + 1);
                        Dataspace.send(SetBox(vs[0] + 1));
                    });
                }
            });
            return { assertion: Observe(BoxState(_$)), analysis };
        });
        Dataspace.currentFacet.addEndpoint(() => {
            let analysis = Skeleton.analyzeAssertion(BoxState(__));
            analysis.callback = Dataspace.wrap((evt, _vs) => {
                if (evt === Skeleton.EventType.REMOVED) {
                    Dataspace.currentFacet.actor.scheduleScript(() => {
                        console.log('box gone');
                    });
                }
            });
            return { assertion: Observe(BoxState(__)), analysis };
        });
    });
}).addStopHandler(() => console.timeEnd('box-and-client-' + N.toString())).start();
