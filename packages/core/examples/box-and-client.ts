#!/usr/bin/env -S npx ts-node -O '{"module": "commonjs"}'
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

import { bootModule, Skeleton, Record, Discard, Capture, Observe, Facet } from '..';
const __ = Discard._instance;
const _$ = Capture(__);

const BoxState = Record.makeConstructor('BoxState', ['value']);
const SetBox = Record.makeConstructor('SetBox', ['newValue']);

const N = 100000;

console.time('box-and-client-' + N.toString());

function boot(thisFacet: Facet<{}>) {
    thisFacet.spawn<{ value: number }>('box', function (thisFacet) {
        thisFacet.declareField(this, 'value', 0);
        thisFacet.addEndpoint(function () {
            // console.log('recomputing published BoxState', this.value);
            return { assertion: BoxState(this.value), analysis: null };
        });
        thisFacet.addDataflow(function () {
            // console.log('dataflow saw new value', this.value);
            if (this.value === N) {
                thisFacet.stop(function () {
                    console.log('terminated box root facet');
                });
            }
        });
        thisFacet.addEndpoint(function () {
            let analysis = Skeleton.analyzeAssertion(SetBox(_$));
            analysis.callback = thisFacet.wrap(function (thisFacet, evt, [v]) {
                if (evt === Skeleton.EventType.MESSAGE) {
                    if (typeof v !== 'number') return;
                    thisFacet.scheduleScript(function () {
                        this.value = v;
                        // console.log('box updated value', v);
                    });
                }
            });
            return { assertion: Observe(SetBox(_$)), analysis };
        });
    });

    thisFacet.spawn('client', function (thisFacet: Facet<{}>) {
        thisFacet.addEndpoint(function () {
            let analysis = Skeleton.analyzeAssertion(BoxState(_$));
            analysis.callback = thisFacet.wrap(function (thisFacet, evt, [v]) {
                if (evt === Skeleton.EventType.ADDED) {
                    if (typeof v !== 'number') return;
                    thisFacet.scheduleScript(function () {
                        // console.log('client sending SetBox', v + 1);
                        thisFacet.send(SetBox(v + 1));
                    });
                }
            });
            return { assertion: Observe(BoxState(_$)), analysis };
        });
        thisFacet.addEndpoint(function () {
            let analysis = Skeleton.analyzeAssertion(BoxState(__));
            analysis.callback = thisFacet.wrap(function (thisFacet, evt, _vs) {
                if (evt === Skeleton.EventType.REMOVED) {
                    thisFacet.scheduleScript(function () {
                        console.log('box gone');
                    });
                }
            });
            return { assertion: Observe(BoxState(__)), analysis };
        });
    });

    thisFacet.actor.dataspace.ground().addStopHandler(function () {
        console.timeEnd('box-and-client-' + N.toString());
    });
}

bootModule(boot);
