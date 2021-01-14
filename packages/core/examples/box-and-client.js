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

new Ground(groundRoot => {
  groundRoot.spawn('box', function (boxRoot) {
    boxRoot.actor.dataspace.declareField(this, 'value', 0);
    boxRoot.addEndpoint(() => {
      // console.log('recomputing published BoxState', this.value);
      return { assertion: BoxState(this.value), analysis: null };
    });
    boxRoot.addDataflow(() => {
      // console.log('dataflow saw new value', this.value);
      if (this.value === N) {
        boxRoot.stop(() => {
          console.log('terminated box root facet');
        });
      }
    });
    boxRoot.addEndpoint(() => {
      let analysis = Skeleton.analyzeAssertion(SetBox(_$));
      analysis.callback = boxRoot.wrap((facet, evt, vs) => {
        if (evt === Skeleton.EventType.MESSAGE) {
          boxRoot.scheduleScript(() => {
            this.value = vs[0];
            // console.log('box updated value', vs[0]);
          });
        }
      });
      return { assertion: Observe(SetBox(_$)), analysis };
    });
  });

  groundRoot.spawn('client', function (clientRoot) {
    clientRoot.addEndpoint(() => {
      let analysis = Skeleton.analyzeAssertion(BoxState(_$));
      analysis.callback = clientRoot.wrap((facet, evt, vs) => {
        if (evt === Skeleton.EventType.ADDED) {
          clientRoot.scheduleScript(() => {
            // console.log('client sending SetBox', vs[0] + 1);
            clientRoot.send(SetBox(vs[0] + 1));
          });
        }
      });
      return { assertion: Observe(BoxState(_$)), analysis };
    });
    clientRoot.addEndpoint(() => {
      let analysis = Skeleton.analyzeAssertion(BoxState(__));
      analysis.callback = clientRoot.wrap((facet, evt, _vs) => {
        if (evt === Skeleton.EventType.REMOVED) {
          clientRoot.scheduleScript(() => {
            console.log('box gone');
          });
        }
      });
      return { assertion: Observe(BoxState(__)), analysis };
    });
  });
}).addStopHandler(() => console.timeEnd('box-and-client-' + N.toString())).start();
