"use strict";

const P = activate require("./internal_protocol");
const W = activate require("./protocol");
const C = activate require("./client");
const B = activate require("./buffer");
const { recorder } = activate require("./turn");
const debugFactory = require('debug');

assertion type ManagementScope(scope) = Symbol.for('federation-management-scope');

assertion type Uplink(localScope, peer, remoteScope) = Symbol.for('federated-uplink');
assertion type UplinkConnected(link) = Symbol.for('federated-uplink-connected');

Object.assign(module.exports, {
  ManagementScope,
  Uplink, UplinkConnected,
});

import {
  Set, Map, List,
  Observe,
  Skeleton, Dataspace, currentFacet,
  genUuid,
} from "@syndicate-lang/core";

spawn named '@syndicate-lang/server/federation/UplinkFactory' {
  during ManagementScope($managementScope) {
    during P.Envelope(managementScope, $link(Uplink($localScope, $peerAddr, $remoteScope)))
      spawn named link
    {
      during C.ServerConnected(peerAddr) {
        const sessionId = genUuid('peer');

        const debug = debugFactory('syndicate/server:federation:uplink:' + sessionId);
        on start debug('+', peerAddr.toString());
        on stop debug('-', peerAddr.toString());

        assert P.Proposal(managementScope, UplinkConnected(link));
        assert P.Proposal(managementScope, P.FederatedLink(sessionId, localScope));
        assert C.ToServer(peerAddr, P.FederatedLink(sessionId, remoteScope));

        const pendingIn = B.buffer(this, 'pendingIn');
        const pendingOut = B.buffer(this, 'pendingOut');

        on message C.FromServer(peerAddr, P.ToPOA(sessionId, $p)) pendingIn.push(p);
        on message P.Envelope(managementScope, P.ToPOA(sessionId, $p)) pendingOut.push(p);

        during P.Envelope(managementScope, P.FederatedLinkReady(sessionId)) {
          debug('Local end is ready');
          during C.FromServer(peerAddr, P.FederatedLinkReady(sessionId)) {
            debug('Remote end is ready');
            pendingIn.drain((p) => { send P.Proposal(managementScope, P.FromPOA(sessionId, p)); });
            pendingOut.drain((p) => { send C.ToServer(peerAddr, P.FromPOA(sessionId, p)); });
          }
        }
      }
    }
  }
}

spawn named '@syndicate-lang/server/federation/LocalLinkFactory' {
  during ManagementScope($managementScope) {
    during P.Envelope(managementScope, P.FederatedLink(_, $scope)) {
      during P.ServerActive(scope)
        spawn named ['@syndicate-lang/server/federation/LocalLink', managementScope, scope]
      {
        const sessionId = genUuid('localLink');

        const debug = debugFactory('syndicate/server:federation:local:' + scope);
        on start debug('+', sessionId);
        on stop debug('-', sessionId);

        assert P.Proposal(managementScope, P.FederatedLink(sessionId, scope));

        const sendFromPOA = (m) => { send P.Proposal(managementScope, P.FromPOA(sessionId, m)); };
        const outboundTurn = recorder(this, 'commitNeeded', (items) => sendFromPOA(W.Turn(items)));

        let remoteEndpoints = Map();
        let localEndpoints = Map();
        let localMatches = Map();

        const _inst = (m, vs) => Skeleton.instantiateAssertion(P.Envelope(scope, m.spec), vs);

        const _lookup = (CTOR, item) => {
          const m = localMatches.get(CTOR._endpointName(item));
          const vs = CTOR._captures(item);
          return { m, vs };
        }

        on asserted Observe(P.Envelope(scope, $spec)) {
          const ep = genUuid('ep');
          debug('localObs+', spec.toString(), ep);
          outboundTurn.extend(W.Assert(ep, Observe(spec)));
          localEndpoints = localEndpoints.set(spec, ep);
          localMatches = localMatches.set(ep, { spec, captures: Map() });
        }

        on retracted Observe(P.Envelope(scope, $spec)) {
          const ep = localEndpoints.get(spec);
          debug('localObs-', spec.toString(), ep);
          outboundTurn.extend(W.Clear(ep));
          localEndpoints = localEndpoints.remove(spec);
        }

        on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Turn($items))) {
          items.forEach((item) => {
            if (W.Assert.isClassOf(item)) {
              const a = W.Assert._assertion(item);
              if (Observe.isClassOf(a)) {
                const ep = W.Assert._endpointName(item);
                const spec = Observe._specification(a);
                if (remoteEndpoints.has(ep)) {
                  throw new Error("Attempt to replace existing endpoint " + ep + " with " + a);
                }
                react {
                  const epFacet = currentFacet();
                  remoteEndpoints = remoteEndpoints.set(ep, epFacet);
                  on stop { remoteEndpoints = remoteEndpoints.remove(ep); }

                  on start debug('remoteObs+', spec.toString());
                  on stop debug('remoteObs-', spec.toString());
                  currentFacet().addObserverEndpoint(() => P.Proposal(scope, spec), {
                    add: (vs) => outboundTurn.extend(W.Add(ep, vs)),
                    del: (vs) => outboundTurn.extend(W.Del(ep, vs)),
                    msg: (vs) => outboundTurn.extend(W.Msg(ep, vs)),
                  });
                  assert P.Envelope(scope, Observe(spec));
                }
              }
            } else if (W.Clear.isClassOf(item)) {
              const ep = W.Clear._endpointName(item);
              if (!remoteEndpoints.has(ep)) {
                throw new Error("Attempt to clear nonexistent endpoint " + ep);
              }
              remoteEndpoints.get(ep).stop(() => { outboundTurn.extend(W.End(ep)); });
            } else if (W.Add.isClassOf(item)) {
              const { m, vs } = _lookup(W.Add, item);
              const a = _inst(m, vs);
              m.captures = m.captures.set(vs, a);
              currentFacet().actor.adhocAssert(a);
            } else if (W.Del.isClassOf(item)) {
              const { m, vs } = _lookup(W.Del, item);
              currentFacet().actor.adhocRetract(m.captures.get(vs));
              m.captures = m.captures.remove(vs);
            } else if (W.Msg.isClassOf(item)) {
              const { m, vs } = _lookup(W.Msg, item);
              send _inst(m, vs);
            } else if (W.End.isClassOf(item)) {
              const ep = W.End._endpointName(item);
              const m = localMatches.get(ep);
              if (m) {
                m.captures.forEach((a) => currentFacet().actor.adhocRetract(a));
                localMatches = localMatches.remove(ep);
              }
            } else if (W.Err.isClassOf(item)) {
              throw new Error(item.toString());
            } else {
              debug("Unhandled federation message", item.toString());
            }
          });
        }
      }
    }
  }
}

class Subscription {
  constructor(id, spec, owner) {
    this.id = id;
    this.spec = spec;
    this.holders = Map();
    this.matches = Map();
    this.owner = owner;

    this.owner.specs = this.owner.specs.set(spec, id);
    this.owner.subs = this.owner.subs.set(id, this);
  }

  isEmpty() {
    return this.holders.isEmpty() && this.matches.isEmpty();
  }

  maybeRemove() {
    if (this.isEmpty()) {
      this.owner.specs = this.owner.specs.remove(this.spec);
      this.owner.subs = this.owner.subs.remove(this.id);
    }
  }

  addHolder(linkid, ep) {
    this.holders = this.holders.set(linkid, ep);
  }

  removeHolder(linkid) {
    this.holders = this.holders.remove(linkid);
    this.maybeRemove();
  }

  addMatch(captures, linkid) {
    const oldMatchHolders = this.matches.get(captures) || Set();
    const newMatchHolders = oldMatchHolders.add(linkid);
    this.matches = this.matches.set(captures, newMatchHolders);
    return oldMatchHolders;
  }

  removeMatch(captures, linkid) {
    const oldMatchHolders = this.matches.get(captures) || Set();
    const newMatchHolders = oldMatchHolders.remove(linkid);
    this.matches = (newMatchHolders.isEmpty())
      ? this.matches.remove(captures)
      : this.matches.set(captures, newMatchHolders);
    this.maybeRemove();
    return newMatchHolders;
  }
}

spawn named '@syndicate-lang/server/federation/ScopeFactory' {
  during ManagementScope($managementScope) {
    during P.Envelope(managementScope, P.FederatedLink(_, $scope))
      spawn named ['@syndicate-lang/server/federation/Scope', scope]
    {
      // function sendToLink(linkid, m) {
      //   send P.Proposal(managementScope, P.ToPOA(linkid, m));
      // }

      let nextId = 0;
      const makeLocalId = () => {
        nextId++;
        return nextId;
      };

      field this.turns = Map();
      field this.specs = Map();
      field this.subs = Map();
      const scopeThis = this;

      const callWithSub = (localid, linkid, f, notFoundIsBad) => {
        const sub = this.subs.get(localid, false);
        if (!sub) {
          // Mention of a nonexistent local ID could be an error, or could be OK. It's fine if
          // we receive Add/Del/Msg for an endpoint we've sent a Clear for but haven't yet seen
          // the matching End; it's not OK if we receive a Clear for an ep that maps to a
          // localid which is then not found.
          if (notFoundIsBad) {
            console.error("Ignoring mention of nonexistent local ID", localid, linkid);
          } else {
            // Nothing to do except wait for an appropriate End to arrive. Perhaps in future we
            // could record the fact we're waiting for an End, so that we could positively know
            // that a given nonexistent ID is a non-error, rather than assuming it's a
            // non-error in all cases except Clear.
          }
        } else {
          return f(sub);
        }
      };

      const unsubscribe = (localid, linkid) => {
        callWithSub(localid, linkid, (sub) => {
          sub.removeHolder(linkid);
          switch (sub.holders.size) {
            case 0:
              this.turns.forEach((turn, peer) => {
                if (peer !== linkid) turn.extend(W.Clear(localid));
              });
              break;
            case 1:
              sub.holders.forEach((peerEndpoint, peer) => { // only one, guaranteed ≠ linkid
                this.turns.get(peer).extend(W.Clear(localid));
              });
              break;
            default:
              break;
          }
        }, true);
      };

      const removeMatch = (localid, captures, linkid) => {
        callWithSub(localid, linkid, (sub) => {
          const newMatchHolders = sub.removeMatch(captures, linkid);
          switch (newMatchHolders.size) {
            case 0:
              sub.holders.forEach((peerEndpoint, peer) => {
                if (peer !== linkid) this.turns.get(peer).extend(W.Del(peerEndpoint, captures));
              });
              break;
            case 1: {
              const peer = newMatchHolders.first(); // only one, guaranteed ≠ linkid
              const peerEndpoint = sub.holders.get(peer, false);
              if (peerEndpoint) this.turns.get(peer).extend(W.Del(peerEndpoint, captures));
              break;
            }
            default:
              break;
          }
        });
      };

      during P.Envelope(managementScope, P.FederatedLink($linkid, scope)) {
        const debug = debugFactory('syndicate/server:federation:link:' + linkid);
        on start debug('+', scope.toString());
        on stop debug('-', scope.toString());
        on message P.Envelope(managementScope, P.FromPOA(linkid, $m)) debug('<', m.toString());
        on message P.Envelope(managementScope, P.ToPOA(linkid, $m)) debug('>', m.toString());

        assert P.Proposal(managementScope, P.FederatedLinkReady(linkid));

        const turn = recorder(this, 'commitNeeded', (items) => {
          send P.Proposal(managementScope, P.ToPOA(linkid, W.Turn(items)));
        });

        field this.linkSubs = Map();
        field this.linkMatches = Map();

        const err = (detail, context) => {
          send P.Proposal(managementScope, P.ToPOA(linkid, W.Err(detail, context || false)));
          turn.reset();
          currentFacet().stop();
        };

        on start {
          this.turns = this.turns.set(linkid, turn);
          this.specs.forEach((localid, spec) => turn.extend(W.Assert(localid, Observe(spec))));
          turn.commit();
        }

        on stop {
          this.turns = this.turns.remove(linkid);
          this.linkMatches.forEach((matches, localid) => {
            matches.forEach((captures) => removeMatch(localid, captures, linkid));
          });
          this.linkSubs.forEach((localid, _endpointId) => {
            unsubscribe(localid, linkid);
          });
          turn.commit();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Turn($items))) {
          items.forEach((item) => {
            if (W.Assert.isClassOf(item)) {
              const ep = W.Assert._endpointName(item);
              const a = W.Assert._assertion(item);
              if (Observe.isClassOf(a)) {
                const spec = Observe._specification(a);

                let localid = this.specs.get(spec, null);
                let sub;
                if (localid === null) {
                  localid = makeLocalId();
                  sub = new Subscription(localid, spec, scopeThis);
                } else {
                  sub = this.subs.get(localid);
                }

                const oldHolderCount = sub.holders.size;
                sub.addHolder(linkid, ep);
                this.linkSubs = this.linkSubs.set(ep, sub.id);
                switch (oldHolderCount) {
                  case 0:
                    this.turns.forEach((turn, peer) => {
                      if (peer !== linkid) turn.extend(W.Assert(localid, Observe(spec)));
                    });
                    break;
                  case 1:
                    sub.holders.forEach((peerEndpoint, peer) => {
                      // ^ now contains 2, one of which is us
                      if (peer !== linkid) {
                        this.turns.get(peer).extend(W.Assert(localid, Observe(spec)));
                      }
                    });
                    break;
                  default:
                    break;
                }

                sub.matches.forEach((matchHolders, captures) => {
                  if (!matchHolders.remove(linkid).isEmpty()) {
                    turn.extend(W.Add(ep, captures));
                  }
                });
              }
            } else if (W.Clear.isClassOf(item)) {
              const ep = W.Clear._endpointName(item);
              const localid = this.linkSubs.get(ep, null);
              if (localid === null) {
                console.error("Ignoring mention of nonexistent endpoint", ep, linkid);
              } else {
                this.linkSubs = this.linkSubs.remove(ep);
                unsubscribe(localid, linkid);
              }
              turn.extend(W.End(ep));
            } else if (W.End.isClassOf(item)) {
              const localid = W.End._endpointName(item);
              (this.linkMatches.get(localid) || Set()).forEach((captures) => {
                removeMatch(localid, captures, linkid);
              });
              this.linkMatches = this.linkMatches.remove(localid);
            } else if (W.Add.isClassOf(item)) {
              const localid = W.Add._endpointName(item);
              const captures = W.Add._captures(item);
              const matches = this.linkMatches.get(localid) || Set();
              if (matches.includes(captures)) {
                err(Symbol.for('duplicate-capture'), item);
              } else {
                this.linkMatches = this.linkMatches.set(localid, matches.add(captures));
                callWithSub(localid, linkid, (sub) => {
                  const oldMatchHolders = sub.addMatch(captures, linkid);
                  switch (oldMatchHolders.size) {
                    case 0:
                      sub.holders.forEach((peerEndpoint, peer) => {
                        if (peer !== linkid) {
                          this.turns.get(peer).extend(W.Add(peerEndpoint, captures));
                        }
                      });
                      break;
                    case 1: {
                      const peer = oldMatchHolders.first(); // only one, guaranteed ≠ linkid
                      const peerEndpoint = sub.holders.get(peer, false);
                      if (peerEndpoint) {
                        this.turns.get(peer).extend(W.Add(peerEndpoint, captures));
                      }
                      break;
                    }
                    default:
                      break;
                  }
                });
              }
            } else if (W.Del.isClassOf(item)) {
              const localid = W.Del._endpointName(item);
              const captures = W.Del._captures(item);
              const matches = this.linkMatches.get(localid) || Set();
              if (!matches.includes(captures)) {
                err(Symbol.for('nonexistent-capture'), item);
              } else {
                const newMatches = matches.remove(captures);
                this.linkMatches = (newMatches.isEmpty())
                  ? this.linkMatches.remove(localid)
                  : this.linkMatches.set(localid, newMatches);
                removeMatch(localid, captures, linkid);
              }
            } else if (W.Msg.isClassOf(item)) {
              const localid = W.Msg._endpointName(item);
              const captures = W.Msg._captures(item);
              callWithSub(localid, linkid, (sub) => {
                sub.holders.forEach((peerEndpoint, peer) => {
                  if (peer !== linkid) {
                    this.turns.get(peer).extend(W.Msg(peerEndpoint, captures));
                  }
                });
              });
            } else {
              debug("Unhandled federation message", item.toString());
            }
          });
        }
      }
    }
  }
}
