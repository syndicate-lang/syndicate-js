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
const { Skeleton, Dataspace, Observe, Capture, Discard } = Syndicate;

describe('dataspace', () => {
  it('should boot and run', () => {
    // TODO: convert this into even a rudimentary somewhat-real test case
    // (change console.log into gathering a trace)
    let ds = new Dataspace(() => {
      // console.log('boot');
      Dataspace.currentFacet().addEndpoint(() => {
        let handler = Skeleton.analyzeAssertion(Capture(Discard()));
        handler.callback = (evt, vs) => {
          if (Observe.isClassOf(vs.get(0))) {
            // console.log('OBSERVATION EVENT',
            //             evt,
            //             vs,
            //             Immutable.is(vs.get(0).get(0), Capture(Discard())));
          } else {
            // console.log('EVENT', evt, vs);
          }
        };
        return [Observe(Capture(Discard())), handler];
      });
      Dataspace.currentFacet().addStartScript(() => {
        Dataspace.deferTurn(() => {
          // console.log('after defer');
          Dataspace.send(1234);
          // console.log('after send');
          Dataspace.spawn('secondproc', () => {
            // console.log('secondproc boot');
          });
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
