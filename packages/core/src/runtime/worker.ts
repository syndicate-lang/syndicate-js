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

// import { Dataspace, Facet } from './dataspace.js';
// import { Observe, Outbound, Inbound, Capture, Discard } from './assertions.js';
// import * as Skeleton from './skeleton.js';

// import { preserves, Value, Bytes, Record, Dictionary, encode, decode } from 'preserves';

// type MessageHandler = (e: Bytes) => void;
// type ImplementationType = 'node.js' | 'browser' | 'none';

// type WorkerConstructor = {
//     new (stringUrl: string | URL, options?: WorkerOptions): Worker;
// };

// function extractBytes(h: MessageHandler): (e: MessageEvent<Bytes> | Bytes) => void {
//     return (e) => {
//         const bs = (e instanceof MessageEvent) ? e.data : e;
//         return h(bs);
//     };
// }

// const WorkerEvent = Record.makeConstructor('--worker-event', ['epId', 'event', 'vs']);
// const { implementationType, _Worker, postMessage, onMessage, isMainThread }: {
//     implementationType: ImplementationType,
//     _Worker?: WorkerConstructor,
//     postMessage?: (m: any) => void,
//     onMessage?: (handler: MessageHandler) => void,
//     isMainThread: boolean,
// } = (function () {
//     try {
//         // Let's see if we're in node.js with the web worker extension enabled.
//         const { Worker, parentPort, isMainThread } = require('worker_threads');
//         return {
//             implementationType: 'node.js' as ImplementationType,
//             _Worker: Worker,
//             postMessage: (m: any) => parentPort.postMessage(m),
//             onMessage: (handler: MessageHandler) => {
//                 parentPort.removeAllListeners('message');
//                 parentPort.on('message', extractBytes(handler));
//             },
//             isMainThread,
//         };
//     } catch (_e) {
//         // Well, something didn't work there. Could we be in the browser?
//         if (typeof window !== 'undefined' && 'Worker' in window) {
//             // Yep.
//             return {
//                 implementationType: 'browser' as ImplementationType,
//                 _Worker: Worker,
//                 postMessage,
//                 onMessage: (handler: MessageHandler) => onmessage = extractBytes(handler),
//                 isMainThread: (typeof self === 'undefined'),
//             };
//         } else {
//             // Nope. No support, then.
//             return {
//                 implementationType: 'none' as ImplementationType,
//                 isMainThread: true,
//             };
//         }
//     }
// })();

// function encodePacket(p: Value) {
//     return Bytes.toIO(encode(p));
// }

// function decodePacket(m: Bytes) {
//     return decode(m);
// }

// function sendPacket(ch: Worker, p: Value) {
//   ch.postMessage(encodePacket(p));
// }

// function listen(w: Worker, eventType: string, handler: (... args: any[]) => any) {
//     if ('on' in w) {
//         (w as any).on(eventType, handler);
//         return;
//     }

//     const k = 'on' + eventType;
//     if (k in w) {
//         w[k] = handler;
//     }
// }

// export function spawnWorker(workerSourceFilename: string) {
//     if (implementationType === 'none') {
//         // In older versions of node.js, try adding --experimental-worker flag to the command line.
//         throw new Error("Cannot spawnWorker without a web worker implementation available");
//     }

//     Dataspace.spawn(workerSourceFilename, function () {
//         const outerFacet = Dataspace.currentFacet;
//         outerFacet.addDataflow(function () {});
//         // ^ eww! Dummy endpoint to keep the root facet of the relay alive.

//         let endpoints = new Dictionary<Facet>();

//         const w = new _Worker(workerSourceFilename);
//         listen(w, 'error', Dataspace.wrapExternal((err) => {
//             throw err;
//         }));
//         listen(w, 'exit', Dataspace.wrapExternal(() => {
//             outerFacet.stop();
//         }));
//         listen(w, 'message', Dataspace.wrapExternal(extractBytes((msg: Bytes) => {
//             const m = decodePacket(msg) as Array<Value>;
//             switch (m[0]) {
//                 case 'assert': {
//                     const [ep, a] = m.slice(1);
//                     if (!endpoints.has(ep)) {
//                         outerFacet.actor.addFacet(outerFacet, function () {
//                             const epFacet = Dataspace.currentFacet;
//                             endpoints = endpoints.set(ep, epFacet);
//                             epFacet.addStopScript(() => { endpoints.delete(ep); });
//                             Dataspace.declareField(this, 'assertion', a);
//                             epFacet.addEndpoint(() => {
//                                 if (Observe.isClassOf(this.assertion)) {
//                                     const spec = this.assertion.get(0);
//                                     const analysis = Skeleton.analyzeAssertion(spec);
//                                     analysis.callback = Dataspace.wrap((evt, vs) => {
//                                         epFacet.actor.scheduleScript(() => {
//                                             sendPacket(w, ['event', ep, evt, vs]);
//                                         });
//                                     });
//                                     return { assertion: Observe(spec), analysis };
//                                 } else {
//                                     return { assertion: this.assertion, analysis: null };
//                                 }
//                             }, true);
//                         }, true);
//                     } else {
//                         endpoints.get(ep).fields.assertion = a;
//                     }
//                     break;
//                 }
//                 case 'clear': {
//                     const ep = m[1];
//                     const epFacet = endpoints.get(ep);
//                     if (epFacet) epFacet.stop(() => { endpoints.delete(ep); });
//                     break;
//                 }
//                 case 'message': {
//                     const body = m[1];
//                     Dataspace.send(body);
//                     break;
//                 }
//                 default: {
//                     throw new Error(
//                         preserves`Invalid Worker protocol message from Worker: ${m}`);
//                 }
//             }
//         })));
//     }, null);
// }

// export function spawnWorkerRelay() {
//     if (implementationType === 'none') return;
//     if (isMainThread) return;

//     Dataspace.currentFacet.actor.dataspace.ground().addStopHandler(() => {
//         process.exit();
//     });

//     Dataspace.currentFacet.addStartScript(function () {
//         Dataspace.spawn('WorkerRelay', function () {
//             const outerFacet = Dataspace.currentFacet;

//             const finish = Dataspace.backgroundTask();
//             outerFacet.addStopScript(finish);

//             const outboundEndpoints = new Dictionary<number>();
//             const inboundEndpoints = new Dictionary<{ epId: number, facet: Facet }>();
//             let nextId = 0;

//             function sendToParent(m: Value) {
//                 postMessage(encodePacket(m));
//             }

//             onMessage(Dataspace.wrapExternal(function (msg: Bytes) {
//                 const m = decodePacket(msg);
//                 if (Array.isArray(m) && m[0] === 'event') {
//                     const [epId, evt, vs] = m.slice(1);
//                     Dataspace.send(WorkerEvent(epId, evt, vs));
//                 } else {
//                     throw new Error(
//                         preserves`Invalid Worker protocol message from parent: ${m}`);
//                 }
//             }));

//             outerFacet.addEndpoint(function () {
//                 const analysis = Skeleton.analyzeAssertion(Outbound(Capture(Discard._instance)));
//                 analysis.callback = Dataspace.wrap(function (evt, vs) {
//                     outerFacet.actor.scheduleScript(function () {
//                         switch (evt) {
//                             case Skeleton.EventType.ADDED: {
//                                 const epId = nextId++;
//                                 outboundEndpoints.set(vs[0], epId);
//                                 sendToParent(['assert', epId, vs[0]]);
//                                 break;
//                             }
//                             case Skeleton.EventType.REMOVED: {
//                                 const epId = outboundEndpoints.get(vs[0]);
//                                 outboundEndpoints.delete(vs[0]);
//                                 sendToParent(['clear', epId]);
//                                 break;
//                             }
//                             case Skeleton.EventType.MESSAGE: {
//                                 sendToParent(['message', vs[0]]);
//                                 break;
//                             }
//                         }
//                     });
//                 });
//                 return { assertion: analysis.assertion, analysis };
//             }, false);

//             outerFacet.addEndpoint(function () {
//                 const analysis =
//                     Skeleton.analyzeAssertion(Observe(Inbound(Capture(Discard._instance))));
//                 analysis.callback = Dataspace.wrap(function (evt, vs) {
//                     outerFacet.actor.scheduleScript(function () {
//                         const spec = vs[0];
//                         switch (evt) {
//                             case Skeleton.EventType.ADDED: {
//                                 const epId = nextId++;
//                                 outerFacet.actor.addFacet(outerFacet, function () {
//                                     const innerFacet = Dataspace.currentFacet;
//                                     inboundEndpoints.set(spec, { epId, facet: innerFacet });
//                                     innerFacet.addEndpoint(function () {
//                                         const analysis = Skeleton.analyzeAssertion(
//                                             WorkerEvent(epId, Capture(Discard._instance), Capture(Discard._instance)));
//                                         analysis.callback = Dataspace.wrap(function (evt, vs) {
//                                             if (evt === Skeleton.EventType.MESSAGE) {
//                                                 evt = vs[0] as Skeleton.EventType;
//                                                 vs = vs[1] as Array<Value>;
//                                                 const a = Skeleton.instantiateAssertion(Inbound(spec), vs);
//                                                 innerFacet.actor.scheduleScript(function () {
//                                                     switch (evt) {
//                                                         case Skeleton.EventType.ADDED:
//                                                             innerFacet.actor.addFacet(innerFacet, function () {
//                                                                 const assertionFacet = Dataspace.currentFacet;
//                                                                 assertionFacet.addEndpoint(function () {
//                                                                     return { assertion: a, analysis: null };
//                                                                 }, false);
//                                                                 assertionFacet.addEndpoint(function () {
//                                                                     const analysis = Skeleton.analyzeAssertion(
//                                                                         WorkerEvent(epId, Skeleton.EventType.REMOVED, vs));
//                                                                     analysis.callback = Dataspace.wrap(() => {
//                                                                         assertionFacet.actor.scheduleScript(function () {
//                                                                             assertionFacet.stop();
//                                                                         });
//                                                                     });
//                                                                     return { assertion: analysis.assertion, analysis };
//                                                                 }, false);
//                                                             }, true);
//                                                             break;
//                                                         case Skeleton.EventType.MESSAGE:
//                                                             Dataspace.send(a);
//                                                             break;
//                                                     }
//                                                 });
//                                             }
//                                         });
//                                         return { assertion: analysis.assertion, analysis };
//                                     }, false);
//                                 }, true);
//                                 sendToParent(['assert', epId, Observe(spec)]);
//                                 break;
//                             }
//                             case Skeleton.EventType.REMOVED: {
//                                 const { epId, facet } = inboundEndpoints.get(spec);
//                                 inboundEndpoints.delete(spec);
//                                 facet.stop();
//                                 sendToParent(['clear', epId]);
//                                 break;
//                             }
//                         }
//                     });
//                 });
//                 return { assertion: analysis.assertion, analysis };
//             }, false);
//         }, null);
//     });
// }
