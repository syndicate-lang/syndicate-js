"use strict";

const P = activate require("./internal_protocol");
const W = activate require("./protocol");
const C = activate require("./client");
const B = activate require("./buffer");
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

        on message C.FromServer(peerAddr, P.ToPOA(sessionId, $p)) {
          pendingIn.push(p);
        }

        on message P.Envelope(managementScope, P.ToPOA(sessionId, $p)) {
          pendingOut.push(p);
        }

        during P.Envelope(managementScope, P.FederatedLinkReady(sessionId)) {
          during C.FromServer(peerAddr, P.FederatedLinkReady(sessionId)) {
            pendingIn.drain((p) => {
              debug('<', p.toString());
              send P.Proposal(managementScope, P.FromPOA(sessionId, p));
            });
            pendingOut.drain((p) => {
              debug('>', p.toString());
              send C.ToServer(peerAddr, P.FromPOA(sessionId, p));
            });
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

        const sendFromPOA = (m) => {
          send P.Proposal(managementScope, P.FromPOA(sessionId, m));
        };

        on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Assert($ep, Observe($spec)))) {
          react {
            on start debug('remoteObs+', spec.toString());
            on stop debug('remoteObs-', spec.toString());
            currentFacet().addObserverEndpoint(() => P.Proposal(scope, spec), {
              add: (vs) => sendFromPOA(W.Add(ep, vs)),
              del: (vs) => sendFromPOA(W.Del(ep, vs)),
              msg: (vs) => sendFromPOA(W.Msg(ep, vs)),
            });
            assert P.Envelope(scope, Observe(spec));
            stop on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Clear(ep))) {
              sendFromPOA(W.End(ep));
            }
          }
        }

        during Observe($pat(P.Envelope(scope, $spec))) {
          const ep = genUuid('ep');
          on start debug('localObs+', spec.toString(), ep);
          on stop debug('localObs-', spec.toString(), ep);
          on start sendFromPOA(W.Assert(ep, Observe(spec)));
          on stop sendFromPOA(W.Clear(ep));
          on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Add(ep, $captures))) {
            react {
              assert Skeleton.instantiateAssertion(pat, captures);
              stop on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Del(ep, captures)));
            }
          }
          on message P.Envelope(managementScope, P.ToPOA(sessionId, W.Msg(ep, $captures))) {
            send Skeleton.instantiateAssertion(pat, captures);
          }
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
    function sendToLink(linkid, m) {
      send P.Proposal(managementScope, P.ToPOA(linkid, m));
    }

    during P.Envelope(managementScope, P.FederatedLink(_, $scope))
      spawn named ['@syndicate-lang/server/federation/Scope', scope]
    {
      let nextId = 0;
      const makeLocalId = () => {
        nextId++;
        return nextId;
      };

      field this.peers = Set();
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
              this.peers.forEach((peer) => {
                if (peer !== linkid) sendToLink(peer, W.Clear(localid));
              });
              break;
            case 1:
              sub.holders.forEach((peerEndpoint, peer) => { // only one, guaranteed ≠ linkid
                sendToLink(peer, W.Clear(localid));
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
                if (peer !== linkid) sendToLink(peer, W.Del(peerEndpoint, captures));
              });
              break;
            case 1: {
              const peer = newMatchHolders.first(); // only one, guaranteed ≠ linkid
              const peerEndpoint = sub.holders.get(peer, false);
              if (peerEndpoint) sendToLink(peer, W.Del(peerEndpoint, captures));
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

        field this.linkSubs = Map();
        field this.linkMatches = Map();

        // const summarise = () => {
        //   console.log('----------------------------------------', scope);
        //   this.peers.forEach((peer) => console.log('  peer', peer));
        //   this.specs.forEach((localid, spec) => {
        //     console.log('  spec', spec.toString(), localid);
        //     const sub = this.subs.get(localid);
        //     sub.holders.forEach((peerEndpoint, peer) => {
        //       console.log('    sub', peer, peerEndpoint);
        //     });
        //     sub.matches.forEach((matchHolders, captures) => {
        //       console.log('    match', captures.toString(), matchHolders.toJSON());
        //     });
        //   });
        // };

        const err = (detail) => {
          sendToLink(linkid, W.Err(detail));
          currentFacet().stop();
        };

        on start {
          this.peers = this.peers.add(linkid);
          // console.log('+PEER', linkid, scope, this.peers);
          this.specs.forEach((localid, spec) => {
            sendToLink(linkid, W.Assert(localid, Observe(spec)));
          });
          // summarise();
        }

        on stop {
          this.peers = this.peers.remove(linkid);
          // console.log('-PEER', linkid, scope);
          this.linkMatches.forEach((matches, localid) => {
            matches.forEach((captures) => removeMatch(localid, captures, linkid));
          });
          this.linkSubs.forEach((localid, _endpointId) => {
            unsubscribe(localid, linkid);
          });
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Assert($ep, Observe($spec)))) {
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
              this.peers.forEach((peer) => {
                if (peer !== linkid) sendToLink(peer, W.Assert(localid, Observe(spec)));
              });
              break;
            case 1:
              sub.holders.forEach((peerEndpoint, peer) => { // now contains 2, one of which is us
                if (peer !== linkid) sendToLink(peer, W.Assert(localid, Observe(spec)));
              });
              break;
            default:
              break;
          }
          sub.matches.forEach((matchHolders, captures) => {
            if (!matchHolders.remove(linkid).isEmpty()) {
              sendToLink(linkid, W.Add(ep, captures));
            }
          });
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Clear($ep))) {
          const localid = this.linkSubs.get(ep, null);
          if (localid === null) {
            console.error("Ignoring mention of nonexistent endpoint", ep, linkid);
          } else {
            this.linkSubs = this.linkSubs.remove(ep);
            unsubscribe(localid, linkid);
          }
          sendToLink(linkid, W.End(ep));
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.End($localid))) {
          (this.linkMatches.get(localid) || Set()).forEach((captures) => {
            removeMatch(localid, captures, linkid);
          });
          this.linkMatches = this.linkMatches.remove(localid);
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Add($localid, $captures))) {
          const matches = this.linkMatches.get(localid) || Set();
          if (matches.includes(captures)) {
            err(Symbol.for('duplicate-capture'));
          } else {
            this.linkMatches = this.linkMatches.set(localid, matches.add(captures));
            callWithSub(localid, linkid, (sub) => {
              const oldMatchHolders = sub.addMatch(captures, linkid);
              switch (oldMatchHolders.size) {
                case 0:
                  sub.holders.forEach((peerEndpoint, peer) => {
                    if (peer !== linkid) sendToLink(peer, W.Add(peerEndpoint, captures));
                  });
                  break;
                case 1: {
                  const peer = oldMatchHolders.first(); // only one, guaranteed ≠ linkid
                  const peerEndpoint = sub.holders.get(peer, false);
                  if (peerEndpoint) sendToLink(peer, W.Add(peerEndpoint, captures));
                  break;
                }
                default:
                  break;
              }
            });
          }
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Del($localid, $captures))) {
          const matches = this.linkMatches.get(localid) || Set();
          if (!matches.includes(captures)) {
            err(Symbol.for('nonexistent-capture'));
          } else {
            const newMatches = matches.remove(captures);
            this.linkMatches = (newMatches.isEmpty())
              ? this.linkMatches.remove(localid)
              : this.linkMatches.set(localid, newMatches);
            removeMatch(localid, captures, linkid);
          }
          // summarise();
        }

        on message P.Envelope(managementScope, P.FromPOA(linkid, W.Msg($localid, $captures))) {
          callWithSub(localid, linkid, (sub) => {
            sub.holders.forEach((peerEndpoint, peer) => {
              if (peer !== linkid) sendToLink(peer, W.Msg(peerEndpoint, captures));
            });
          });
        }
      }
    }
  }
}
