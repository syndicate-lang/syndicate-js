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

import {
  Set, Map,
  RandomID,
} from "@syndicate-lang/core";

const fs = require('fs');

spawn named 'peerAdvertisement' {
  const localId = RandomID.randomId(8, false);
  assert OverlayNode(localId);

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
    on start console.log('Gateway IP is', gatewayIp, 'on interface', gatewayInterface);

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

spawn named 'helpful info output' {
  console.info('Peer discovery running');
  during Peer($overlayId, $nodeId, $ip, $addr) {
    on start console.info("+PEER", ip, overlayId, nodeId, addr.toString());
    on stop  console.info("-PEER", ip, overlayId, nodeId, addr.toString());
  }
}

spawn named 'uplinkSelection' {
  field this.gatewayIp = null;
  on asserted M.DefaultGateway(_, $gatewayIp) this.gatewayIp = gatewayIp;

  during OverlayNode($localId) {
    during Federation.ManagementScope($managementScope) {
      during P.Envelope(managementScope, Overlay($overlayId, $rootAddr)) {

        // For each overlay:
        //
        //   Collect all peers.
        //   Partition them into two sets: those on our actual gateway, and those not.
        //   For each set, pick the best element, measured by smallness of nodeId.
        //   If there's a best gateway peer, choose that.
        //   Otherwise, if there's a best non-gateway peer, choose that.
        //
        //   Now, if we have chosen a peer, and that peer is not ourselves, use it;
        //   Otherwise, fall back to a direct connection to the root.

        field this.peers = Set();
        on asserted $p(Peer(overlayId,_,_,_)) this.peers = this.peers.add(p);
        on retracted $p(Peer(overlayId,_,_,_)) this.peers = this.peers.remove(p);

        field this.bestAddr = null;
        field this.bestPeer = null;
        dataflow {
          let best = null;
          const better = (a) => {
            if (!best) return true;
            if ((a.get(2) === this.gatewayIp)) {
              if (best.get(2) !== this.gatewayIp) return true;
              return (a.get(1) < best.get(1));
            } else {
              if (best.get(2) === this.gatewayIp) return false;
              return (a.get(1) < best.get(1));
            }
          };
          this.peers.forEach((p) => { if (better(p)) best = p; });
          if (best && (best.get(1) !== localId)) {
            this.bestAddr = best.get(3);
            this.bestPeer = best;
          } else {
            this.bestAddr = rootAddr;
            this.bestPeer = null;
          }
        }

        dataflow if (this.bestAddr) {
          console.log('Selected uplink for overlay', overlayId, 'is', this.bestAddr.toString());
        }

        assert P.Proposal(managementScope, Federation.Uplink(overlayId, this.bestAddr, overlayId))
          when (this.bestAddr);

        assert P.Proposal(overlayId, OverlayLink(OverlayNode(localId),
                                                 this.bestPeer || OverlayRoot()))
          when (this.bestAddr);
      }
    }
  }
}
