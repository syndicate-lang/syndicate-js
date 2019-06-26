"use strict";

assertion type AvailableTransport(spec);
assertion type WebSocketTransport(port, path);
// S.TcpListener specifies TCP transport
// S.UnixSocketServer specifies Unix socket transport

assertion type Overlay(id, rootAddr);
assertion type OverlayNode(id);
assertion type OverlayRoot();
assertion type OverlayLink(downNode, upNode);

assertion type Peer(overlayId, nodeId, ip, addr);

Object.assign(module.exports, {
  AvailableTransport,
  WebSocketTransport,
  Overlay, OverlayNode, OverlayRoot, OverlayLink,
  Peer,
});

const C = activate require("./client");
const M = activate require("@syndicate-lang/driver-mdns");
const P = activate require("./internal_protocol");
const S = activate require("@syndicate-lang/driver-streams-node");
const Federation = activate require("./federation");
const { TimeLaterThan } = activate require("@syndicate-lang/driver-timer");

import {
  Set, Map,
} from "@syndicate-lang/core";

const fs = require('fs');

const debugFactory = require('debug');
const debug = debugFactory('syndicate/server:disco');

spawn named 'peerAdvertisement' {
  during OverlayNode($localId) {
    on start debug('Local node ID is', localId);

    during Federation.ManagementScope($managementScope) {
      during P.Envelope(managementScope, Overlay($overlayId, _)) {
        const gatewayId = overlayId + ':' + localId;

        during P.Envelope(managementScope, AvailableTransport(WebSocketTransport($port, $path))) {
          assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'), null, port, [
            "path="+path,
            "scope="+managementScope
          ]);
        }

        // Other variants for later:
        // assert M.Publish(M.Service(gatewayId, '_syndicate._tcp'), null, port, []);
      }
    }
  }
}

function txtsToMap(txts) {
  let m = Map();
  txts.forEach((t) => {
    t.split(' ').forEach((kv) => {
      const [k, v] = kv.split('=');
      m = m.set(k, v);
    });
  });
  return m;
}

spawn named 'peerDiscovery' {
  during M.DefaultGateway($gatewayInterface, $gatewayIp) {
    on start debug('Gateway IP is', gatewayIp, 'on interface', gatewayInterface);

    during M.Discovered(M.Service($name, '_syndicate+ws._tcp'),
                        _, // hostname
                        $port,
                        $txts,
                        $addr,
                        "IPv4",
                        gatewayInterface)
    {
      const [overlayId, nodeId] = name.split(':');
      let params = txtsToMap(txts);
      assert Peer(overlayId,
                  nodeId,
                  addr,
                  C.WSServer('ws://' + addr + ':' + port + params.get('path', '/'),
                             params.get('scope', 'local')));
    }
  }
}

spawn named 'syndicate/server:disco:transport' {
  const debug = debugFactory('syndicate/server:disco:transport');
  on asserted AvailableTransport($spec) console.info(spec.toString());
}

spawn named 'syndicate/server:disco:mdns' {
  const debug = debugFactory('syndicate/server:disco:mdns');
  debug('Peer discovery running');
  during Peer($overlayId, $nodeId, $ip, $addr) {
    on start debug("+", ip, overlayId, nodeId, addr.toString());
    on stop  debug("-", ip, overlayId, nodeId, addr.toString());
  }
}

spawn named 'federationRoutingInfo' {
  during Federation.ManagementScope($managementScope) {
    // assert P.Proposal(managementScope, Federation.ManagementScope(managementScope));
    during $t(AvailableTransport(_)) assert P.Proposal(managementScope, t);
  }
}

spawn named 'uplinkSelection' {
  field this.gatewayIp = null;
  on asserted M.DefaultGateway(_, $gatewayIp) this.gatewayIp = gatewayIp;

  function orderByNodeId(peers) {
    return peers.toList().sortBy(Peer._nodeId);
  }

  during OverlayNode($localId) {
    during Federation.ManagementScope($managementScope) {
      during P.Envelope(managementScope, Overlay($overlayId, $rootAddr)) {

        // We constantly maintain a notion of the best uplink to establish.
        // Simultaneously, we try to maintain a stable connection to some upstream peer.

        // To figure out the best uplink:
        //   Collect all peers into two sets:
        //     1. Those on our current gateway IP whose _nodeId is not equal to ours.
        //     2. Those not on the gateway IP whose _nodeId is strictly less than ours.
        //   If there are any nodes in set 1, select the node with the smallest _nodeId.
        //   Otherwise, if there are any nodes in set 2, sort by _nodeId and select the middle one.
        //   Otherwise, select the root.

        field this.peers = Set();
        on asserted $p(Peer(overlayId,_,_,_)) this.peers = this.peers.add(p);
        on retracted $p(Peer(overlayId,_,_,_)) this.peers = this.peers.remove(p);

        field this.bestAddr = null;
        field this.bestPeer = null;
        dataflow {
          const gwPeers = orderByNodeId(this.peers.filter(
            (p) => (Peer._ip(p) === this.gatewayIp) && (Peer._nodeId(p) !== localId)));
          const others = orderByNodeId(this.peers.filter(
            (p) => (Peer._ip(p) !== this.gatewayIp) && (Peer._nodeId(p) < localId)));

          let best = null;
          if (!gwPeers.isEmpty()) {
            best = gwPeers.first();
          } else if (!others.isEmpty()) {
            best = others.get(others.size >> 1);
          } else {
            // Use the root
          }

          if (best) {
            this.bestAddr = Peer._addr(best);
            this.bestPeer = OverlayNode(Peer._nodeId(best));
          } else {
            this.bestAddr = rootAddr;
            this.bestPeer = OverlayRoot();
          }
        }

        dataflow if (this.bestAddr) {
          debug('Current best uplink peer for overlay', overlayId,
                'is', this.bestPeer.toString(),
                'at', this.bestAddr.toString());
        }

        //---------------------------------------------------------------------------

        const futureTime = (deltaMs) => {
          return (+(new Date())) + deltaMs;
        };

        const assertSelectedUplink = (link) => {
          assert P.Proposal(managementScope, link);
        };

        const START = () => {
          react {
            // Wait for stability:
            const timeout = futureTime(5000);
            stop on asserted TimeLaterThan(timeout) CONNECT(null);
          }
        };

        const CONNECT = (prevBestPeer) => {
          // We've settled on something to try.
          const peer = this.bestPeer;
          const addr = this.bestAddr;
          const link = Federation.Uplink(overlayId, addr, overlayId);
          if (!prevBestPeer || !prevBestPeer.equals(peer)) {
            debug('Selecting uplink', peer.toString(), 'for overlay', overlayId);
          }

          react {
            assertSelectedUplink(link);
            const timeout = futureTime(15000);
            stop on asserted TimeLaterThan(timeout) CONNECT(peer);
            stop on retracted peer CONNECT(null);
            stop on asserted P.Envelope(managementScope, Federation.UplinkConnected(link)) {
              MAINTAIN(peer, link);
            }
          }
        };

        const MAINTAIN = (peer, link) => {
          // We're connected.
          react {
            assertSelectedUplink(link);
            assert C.ToServer(C.Loopback(overlayId), OverlayLink(OverlayNode(localId), peer));
            stop on retracted peer CONNECT(null);
            stop on retracted P.Envelope(managementScope, Federation.UplinkConnected(link)) {
              CONNECT(peer);
            }
            if (OverlayRoot.isClassOf(peer)) {
              // See if something better (more local) comes along every now and then.
              const timeout = futureTime(5000);
              stop on asserted TimeLaterThan(timeout) CONNECT(peer);
            }
          }
        };

        on start START();
      }
    }
  }
}
