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

const Immutable = require('immutable');
const Syndicate = require('../src/index.js');
const Skeleton = Syndicate.Skeleton;
const Dataspace = Syndicate.Dataspace;
const Ground = Syndicate.Ground;
const Record = Syndicate.Record;
const __ = Syndicate.Discard._instance;
const _$ = Syndicate.Capture(__);

const BoxState = Record.makeConstructor('BoxState', ['value']);
const SetBox = Record.makeConstructor('SetBox', ['newValue']);

const N = 100000;

console.time('box-and-client-' + N.toString());
let _savedGlobalFacet = Dataspace._currentFacet;
Dataspace._currentFacet = new Syndicate._Dataspace.ActionCollector();

Dataspace.spawn('box', function () {
  Dataspace.declareField(this, 'value', 0);
  Dataspace.currentFacet().addEndpoint(() => {
    return [BoxState(this.value), null];
  });
  Dataspace.currentFacet().addDataflow(() => {
    if (this.value === N) {
      Dataspace.currentFacet().stop(() => {
        console.log('terminated box root facet');
      });
    }
  });
  Dataspace.currentFacet().addEndpoint(() => {
    let handler = Skeleton.analyzeAssertion(SetBox(_$));
    handler.callback = Dataspace.wrap((evt, vs) => {
      if (evt === Skeleton.EVENT_MESSAGE) {
        Dataspace.currentFacet().actor.scheduleScript(() => {
          this.value = vs.get(0);
          // console.log('box updated value', vs.get(0));
        });
      }
    });
    return [Syndicate.Observe(SetBox(_$)), handler];
  });
});

Dataspace.spawn('client', () => {
  Dataspace.currentFacet().addEndpoint(() => {
    let handler = Skeleton.analyzeAssertion(BoxState(_$));
    handler.callback = Dataspace.wrap((evt, vs) => {
      if (evt === Skeleton.EVENT_ADDED) {
        Dataspace.currentFacet().actor.scheduleScript(() => {
          // console.log('client sending SetBox', vs.get(0) + 1);
          Dataspace.send(SetBox(vs.get(0) + 1));
        });
      }
    });
    return [Syndicate.Observe(BoxState(_$)), handler];
  });
  Dataspace.currentFacet().addEndpoint(() => {
    let handler = Skeleton.analyzeAssertion(BoxState(__));
    handler.callback = Dataspace.wrap((evt, vs) => {
      if (evt === Skeleton.EVENT_REMOVED) {
        Dataspace.currentFacet().actor.scheduleScript(() => {
          console.log('box gone');
        });
      }
    });
    return [Syndicate.Observe(BoxState(__)), handler];
  });
});

module.exports[Dataspace.BootSteps] = {
  module: module,
  steps: Dataspace._currentFacet.actions
};
Dataspace._currentFacet = _savedGlobalFacet;
_savedGlobalFacet = null;

Ground.bootModule(module, (g) => {
  g.addStopHandler(() => {
    console.timeEnd('box-and-client-' + N.toString());
  });
});
