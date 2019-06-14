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

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                require('path').basename(module.filename),
                                                module)) return;

const { Dataspace } = require('./dataspace.js');
const { Observe, Outbound, Inbound, Capture, Discard } = require('./assertions.js');
const { $QuitDataspace } = require('./relay.js');
const Skeleton = require('./skeleton.js');
const RandomID = require('./randomid.js');

const { List, Map } = require('immutable');
const { Bytes, Record, Encoder, Decoder } = require("preserves");

const WorkerEvent = Record.makeConstructor('--worker-event', ['epId', 'event', 'vs']);

const worker_threads = (function () {
  try {
    return require('worker_threads');
  } catch (_e) {
    return {
      __isDummyStub: true
    };
  }
})();

function encodePacket(p) {
  return Bytes.toIO(new Encoder().push(p).contents());
}

function decodePacket(m) {
  return new Decoder(m).next();
}

function sendPacket(ch, p) {
  ch.postMessage(encodePacket(p));
}

function spawnWorker(workerSourceFilename, workerData) {
  if (worker_threads.__isDummyStub) {
    throw new Error("Cannot spawnWorker without --experimental-worker flag on node.js command line");
  }
  Dataspace.spawn([workerSourceFilename, workerData], function () {
    const outerFacet = Dataspace.currentFacet();
    outerFacet.addDataflow(function () {});
    // ^ eww! Dummy endpoint to keep the root facet of the relay alive.

    let endpoints = Map();

    const w = new worker_threads.Worker(workerSourceFilename, {
      workerData: encodePacket(workerData || false)
    });
    w.on('error', Dataspace.wrapExternal((err) => {
      throw err;
    }));
    w.on('exit', Dataspace.wrapExternal(() => {
      outerFacet.stop();
    }));
    w.on('message', Dataspace.wrapExternal((m) => {
      m = decodePacket(m);
      switch (m.get(0)) {
        case 'assert': {
          const ep = m.get(1);
          const a = m.get(2);
          if (!endpoints.includes(ep)) {
            outerFacet.actor.addFacet(outerFacet, function () {
              const epFacet = Dataspace.currentFacet();
              endpoints = endpoints.set(ep, epFacet);
              epFacet.addStopScript(() => { endpoints = endpoints.remove(ep); });
              Dataspace.declareField(this, 'assertion', a);
              epFacet.addEndpoint(() => {
                if (Observe.isClassOf(this.assertion)) {
                  const spec = this.assertion.get(0);
                  const analysis = Skeleton.analyzeAssertion(spec);
                  analysis.callback = Dataspace.wrap((evt, vs) => {
                    epFacet.actor.scheduleScript(() => {
                      sendPacket(w, ['event', ep, evt, vs]);
                    });
                  });
                  return [Observe(spec), analysis];
                } else {
                  return [this.assertion, null];
                }
              }, true);
            }, true);
          } else {
            endpoints.get(ep).fields.assertion = a;
          }
          break;
        }
        case 'clear': {
          const ep = m.get(1);
          const epFacet = endpoints.get(ep, false);
          if (epFacet) {
            epFacet.stop(() => {
              endpoints = endpoints.remove(ep);
            });
          }
          break;
        }
        case 'message': {
          const body = m.get(1);
          Dataspace.send(body);
          break;
        }
        default: {
          const err = new Error("Invalid Worker protocol message from Worker");
          err.irritant = m;
          throw err;
        }
      }
    }));
  }, null);
}

function spawnWorkerRelay() {
  if (worker_threads.__isDummyStub) return;
  if (worker_threads.isMainThread) return;

  worker_threads.workerData = decodePacket(worker_threads.workerData);

  Dataspace.currentFacet().actor.dataspace.addStopHandler(() => {
    process.exit();
  });

  Dataspace.currentFacet().addStartScript(function () {
    Dataspace.spawn('WorkerRelay', function () {
      const outerFacet = Dataspace.currentFacet();

      const finish = Dataspace.backgroundTask();
      outerFacet.addStopScript(finish);

      let outboundEndpoints = Map();
      let inboundEndpoints = Map();
      let nextId = 0;

      const parentPort = worker_threads.parentPort;

      function sendToParent(m) {
        sendPacket(parentPort, m);
      }

      parentPort.on('message', Dataspace.wrapExternal(function (m) {
        m = decodePacket(m);
        if (List.isList(m) && m.get(0) === 'event') {
          const epId = m.get(1);
          const evt = m.get(2);
          const vs = m.get(3);
          Dataspace.send(WorkerEvent(epId, evt, vs));
        } else {
          const err = new Error("Invalid Worker protocol message from parent");
          err.irritant = m;
          throw err;
        }
      }));

      outerFacet.addEndpoint(function () {
        const analysis = Skeleton.analyzeAssertion(Outbound(Capture(Discard._instance)));
        analysis.callback = Dataspace.wrap(function (evt, vs) {
          outerFacet.actor.scheduleScript(function () {
            switch (evt) {
              case Skeleton.EVENT_ADDED: {
                const epId = nextId++;
                outboundEndpoints = outboundEndpoints.set(vs.get(0), epId);
                sendToParent(['assert', epId, vs.get(0)]);
                break;
              }
              case Skeleton.EVENT_REMOVED: {
                const epId = outboundEndpoints.get(vs.get(0));
                outboundEndpoints = outboundEndpoints.remove(vs.get(0));
                sendToParent(['clear', epId]);
                break;
              }
              case Skeleton.EVENT_MESSAGE: {
                sendToParent(['message', vs.get(0)]);
                break;
              }
            }
          });
        });
        return [analysis.assertion, analysis];
      }, false);

      outerFacet.addEndpoint(function () {
        const analysis = Skeleton.analyzeAssertion(Observe(Inbound(Capture(Discard._instance))));
        analysis.callback = Dataspace.wrap(function (evt, vs) {
          outerFacet.actor.scheduleScript(function () {
            const spec = vs.get(0);
            switch (evt) {
              case Skeleton.EVENT_ADDED: {
                const epId = nextId++;
                outerFacet.actor.addFacet(outerFacet, function () {
                  const innerFacet = Dataspace.currentFacet();
                  inboundEndpoints = inboundEndpoints.set(spec, { epId, facet: innerFacet });
                  innerFacet.addEndpoint(function () {
                    const analysis = Skeleton.analyzeAssertion(
                      WorkerEvent(epId, Capture(Discard._instance), Capture(Discard._instance)));
                    analysis.callback = Dataspace.wrap(function (evt, vs) {
                      if (evt === Skeleton.EVENT_MESSAGE) {
                        evt = vs.get(0);
                        vs = vs.get(1);
                        const a = Skeleton.instantiateAssertion(Inbound(spec), vs);
                        innerFacet.actor.scheduleScript(function () {
                          switch (evt) {
                            case Skeleton.EVENT_ADDED:
                              innerFacet.actor.addFacet(innerFacet, function () {
                                const assertionFacet = Dataspace.currentFacet();
                                assertionFacet.addEndpoint(function () {
                                  return [a, null];
                                }, false);
                                assertionFacet.addEndpoint(function () {
                                  const analysis = Skeleton.analyzeAssertion(
                                    WorkerEvent(epId, Skeleton.EVENT_REMOVED, vs));
                                  analysis.callback = Dataspace.wrap(function (evt, vs) {
                                    assertionFacet.actor.scheduleScript(function () {
                                      assertionFacet.stop();
                                    });
                                  });
                                  return [analysis.assertion, analysis];
                                }, false);
                              }, true);
                              break;
                            case Skeleton.EVENT_MESSAGE:
                              Dataspace.send(a);
                              break;
                          }
                        });
                      }
                    });
                    return [analysis.assertion, analysis];
                  }, false);
                }, true);
                sendToParent(['assert', epId, Observe(spec)]);
                break;
              }
              case Skeleton.EVENT_REMOVED: {
                const { epId, facet } = inboundEndpoints.get(spec);
                inboundEndpoints = inboundEndpoints.remove(spec);
                facet.stop();
                sendToParent(['clear', epId]);
                break;
              }
            }
          });
        });
        return [analysis.assertion, analysis];
      }, false);
    }, null);
  });
}

module.exports.spawnWorker = spawnWorker;
module.exports.spawnWorkerRelay = spawnWorkerRelay;
