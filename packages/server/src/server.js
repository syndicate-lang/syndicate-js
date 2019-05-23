"use strict";

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");

import {
  Set, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet, genUuid, RandomID
} from "@syndicate-lang/core";

const P = activate require("./internal_protocol");
const W = activate require("./protocol");

export function websocketServerFacet(reqId) {
  assert P.POA(reqId);
  on message Http.DataIn(reqId, $data) {
    if (data instanceof Bytes) send P.FromPOA(reqId, W.makeDecoder(data).next());
  }
  on message P.ToPOA(reqId, $resp) send Http.DataOut(reqId, new Encoder().push(resp).contents());
  stop on message P.Disconnect(reqId);
  stop on retracted P.POAScope(reqId, _);
}

export function streamServerFacet(id) {
  assert P.POA(id);
  const decoder = W.makeDecoder(null);
  on message S.Data(id, $data) {
    decoder.write(data);
    let v;
    while ((v = decoder.try_next())) send P.FromPOA(id, v);
  }
  on message P.ToPOA(id, $resp) send S.Push(id, new Encoder().push(resp).contents(), null);
  stop on message P.Disconnect(id);
  stop on retracted P.POAScope(id, _);
}

export function streamServerActor(id, debugLabel) {
  spawn named [debugLabel || 'stream-poa', id] {
    stop on retracted S.Duplex(id);
    streamServerFacet(id);
  }
}

spawn named '@syndicate-lang/server/server/POAHandler' {
  during P.Proposal($scope, $assertion) assert P.Envelope(scope, assertion);
  on message P.Proposal($scope, $assertion) send P.Envelope(scope, assertion);
  during Observe(P.Envelope($scope, $spec)) assert P.Proposal(scope, Observe(spec));

  during P.POA($connId) spawn named P.POA(connId) {
    field this.scope = null;
    assert P.POAScope(connId, this.scope) when (this.scope !== null);
    assert P.ServerActive(this.scope) when (this.scope !== null);

    let endpoints = Set();

    on message P.FromPOA(connId, W.Connect($scope)) {
      // TODO: Enforce requirement that Connect appear exactly once, before anything else
      this.scope = scope;
    }

    on message P.FromPOA(connId, W.Assert($ep, $a)) {
      if (!endpoints.includes(ep)) {
        endpoints = endpoints.add(ep);
        react {
          on stop { endpoints = endpoints.remove(ep); }

          field this.assertion = a;
          assert P.Proposal(this.scope, this.assertion);

          currentFacet().addEndpoint(() => {
            if (Observe.isClassOf(this.assertion)) {
              const spec = P.Envelope(this.scope, this.assertion.get(0));
              const analysis = Skeleton.analyzeAssertion(spec);
              analysis.callback = Dataspace.wrap((evt, vs) => {
                currentFacet().actor.scheduleScript(() => {
                  switch (evt) {
                    case Skeleton.EVENT_ADDED:   send P.ToPOA(connId, W.Add(ep, vs)); break;
                    case Skeleton.EVENT_REMOVED: send P.ToPOA(connId, W.Del(ep, vs)); break;
                    case Skeleton.EVENT_MESSAGE: send P.ToPOA(connId, W.Msg(ep, vs)); break;
                  }
                });
              });
              return [Observe(spec), analysis];
            } else {
              return [void 0, null];
            }
          }, true);

          on message P.FromPOA(connId, W.Assert(ep, $newAssertion)) this.assertion = newAssertion;
          stop on message P.FromPOA(connId, W.Clear(ep));
        }
      }
    }

    on message P.FromPOA(connId, W.Message($body)) {
      send P.Proposal(this.scope, body);
    }
  }
}
