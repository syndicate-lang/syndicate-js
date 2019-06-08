"use strict";

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const debugFactory = require('debug');

import {
  Map, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet, genUuid,
} from "@syndicate-lang/core";

const P = activate require("./internal_protocol");
const W = activate require("./protocol");
const B = activate require("./buffer");
const { recorder } = activate require("./turn");

export function websocketServerFacet(reqId) {
  assert P.POA(reqId);
  const buf = B.buffer(this, 'chunks');
  on message Http.DataIn(reqId, $data) buf.push(data);
  during P.POAReady(reqId) buf.drain((data) => {
    if (data instanceof Bytes) send P.FromPOA(reqId, W.makeDecoder(data).next());
  });
  on message P.ToPOA(reqId, $resp) send Http.DataOut(reqId, new Encoder().push(resp).contents());
  stop on message P.Disconnect(reqId);
  stop on retracted P.POAReady(reqId);
}

export function streamServerFacet(id) {
  assert P.POA(id);
  const decoder = W.makeDecoder(null);
  const buf = B.buffer(this, 'chunks');
  on message S.Stream(id, S.Data($data)) buf.push(data);
  during P.POAReady(reqId) buf.drain((data) => {
    decoder.write(data);
    let v;
    while ((v = decoder.try_next())) send P.FromPOA(id, v);
  });
  on message P.ToPOA(id, $resp) send S.Stream(id, S.Push(new Encoder().push(resp).contents(), false));
  stop on message P.Disconnect(id);
  stop on retracted P.POAReady(id);
}

export function streamServerActor(id, debugLabel) {
  spawn named [debugLabel || 'stream-poa', id] {
    stop on retracted S.Stream(id, S.Duplex());
    streamServerFacet(id);
  }
}

spawn named '@syndicate-lang/server/server/POAHandler' {
  during P.Proposal($scope, $assertion) assert P.Envelope(scope, assertion);
  on message P.Proposal($scope, $assertion) send P.Envelope(scope, assertion);
  during Observe(P.Envelope($scope, $spec)) assert P.Proposal(scope, Observe(spec));

  during P.POA($connId) spawn named P.POA(connId) {
    const debug = debugFactory('syndicate/server:server:' + connId.toString());
    on start debug('+');
    on stop debug('-');
    on message P.FromPOA(connId, $m) debug('<', m.toString());
    on message P.ToPOA(connId, $m) debug('>', m.toString());

    field this.scope = null;
    assert P.POAReady(connId);
    assert P.POAScope(connId, this.scope) when (this.scope !== null);
    assert P.ServerActive(this.scope) when (this.scope !== null);

    let endpoints = Map();

    on message P.FromPOA(connId, W.Connect($scope)) {
      // TODO: Enforce requirement that Connect appear exactly once, before anything else
      this.scope = scope;
    }

    const sendToPOA = (m) => { send P.ToPOA(connId, m); };
    const outboundTurn = recorder(this, 'commitNeeded', (items) => sendToPOA(W.Turn(items)));

    on message P.FromPOA(connId, W.Turn($items)) {
      items.forEach((item) => {
        if (W.Assert.isClassOf(item)) {
          const ep = W.Assert._endpointName(item);
          const a = W.Assert._assertion(item);
          if (endpoints.has(ep)) {
            throw new Error("Attempt to update existing endpoint " + ep + " with " + a.toString());
          }
          react {
            const epFacet = currentFacet();
            endpoints = endpoints.set(ep, epFacet);
            on stop { endpoints = endpoints.remove(ep); }

            assert P.Proposal(this.scope, a);

            if (Observe.isClassOf(a)) {
              currentFacet().addEndpoint(() => {
                const spec = P.Envelope(this.scope, Observe._specification(a));
                const analysis = Skeleton.analyzeAssertion(spec);
                analysis.callback = Dataspace.wrap((evt, vs) => {
                  currentFacet().actor.scheduleScript(() => {
                    switch (evt) {
                      case Skeleton.EVENT_ADDED:   outboundTurn.extend(W.Add(ep, vs)); break;
                      case Skeleton.EVENT_REMOVED: outboundTurn.extend(W.Del(ep, vs)); break;
                      case Skeleton.EVENT_MESSAGE: outboundTurn.extend(W.Msg(ep, vs)); break;
                    }
                  });
                });
                return [Observe(spec), analysis];
              }, false);
            }
          }
        } else if (W.Clear.isClassOf(item)) {
          const ep = W.Clear._endpointName(item);
          if (!endpoints.has(ep)) {
            throw new Error("Attempt to clear nonexistent endpoint " + ep);
          }
          endpoints.get(ep).stop(() => { outboundTurn.extend(W.End(ep)); });
        } else if (W.Message.isClassOf(item)) {
          send P.Proposal(this.scope, W.Message._body(item));
        } else {
          debug("Unhandled client/server message", item.toString());
        }
      });
    }
  }
}
