"use strict";

const Immutable = require('immutable');
const Syndicate = require('../src/main.js');
const Skeleton = Syndicate.Skeleton;
const Dataspace = Syndicate.Dataspace;
const Struct = Syndicate.Struct;
const __ = Syndicate.__;
const _$ = Syndicate._$;

const BoxState = Struct.makeConstructor('BoxState', ['value']);
const SetBox = Struct.makeConstructor('SetBox', ['newValue']);

const N = 100000;

console.time('box-and-client-' + N.toString());

let ds = new Dataspace(() => {
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
  });
});

// console.log('--- starting ---');
while (ds.runScripts()) {
  // console.log('--- runScripts boundary ---');
}
// console.log('--- done ---');

console.timeEnd('box-and-client-' + N.toString());
