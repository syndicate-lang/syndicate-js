"use strict";

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-immutable'));

const Immutable = require('immutable');

const Syndicate = require('../src/main.js');
const Skeleton = Syndicate.Skeleton;
const Dataspace = Syndicate.Dataspace;
const Struct = Syndicate.Struct;
const __ = Syndicate.__;
const _$ = Syndicate._$;

describe('dataspace', () => {
  it('should boot and run', () => {
    // TODO: convert this into even a rudimentary somewhat-real test case
    // (change console.log into gathering a trace)
    let ds = new Dataspace(() => {
      // console.log('boot');
      Dataspace.currentFacet().addEndpoint(() => {
        let handler = Skeleton.analyzeAssertion(_$);
        handler.callback = (evt, vs) => {
          if (Syndicate.Observe.isClassOf(vs.get(0))) {
            // console.log('OBSERVATION EVENT', evt, vs, vs.get(0).get(0) === _$);
          } else {
            // console.log('EVENT', evt, vs);
          }
        };
        return [Syndicate.Observe(_$), handler];
      });
      Dataspace.deferTurn(() => {
        // console.log('after defer');
        Dataspace.send(1234);
        // console.log('after send');
        Dataspace.spawn('secondproc', () => {
          // console.log('secondproc boot');
        });
      });
    });
    // console.log('--- starting ---');
    while (ds.runScripts()) {
      // console.log('--- runScripts boundary ---');
    }
    // console.log('--- done ---');
  });
});
