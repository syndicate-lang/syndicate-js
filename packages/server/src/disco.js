"use strict";

const C = activate require("./client");
const M = activate require("@syndicate-lang/driver-mdns");
const P = activate require("./internal_protocol");
const S = activate require("@syndicate-lang/driver-streams-node");
const Federation = activate require("./federation");
const D = activate require("./disco_protocol");

import {
  RandomID,
} from "@syndicate-lang/core";

const fs = require('fs');

let currentManagementScope = 'local';

const localId = RandomID.randomId(8, false);
const dataspaceId = 'EToUNUJI0ykSfudmN9Z99wu62qGQB1nd8SHvjNtL5tM'; // public key of root server
const gatewayId = dataspaceId + ':' + localId;

const serverAddr = C.WSServer('ws://localhost:8000/', 'local');

spawn named 'advertise_server' {
  during C.ServerConnected(serverAddr) {
    during C.FromServer(serverAddr, D.AvailableTransport(D.WebSocketTransport($port, $path))) {
      assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'), null, port, ["path="+path]);

      // assert M.Publish(M.Service(gatewayId, '_syndicate._tcp'), null, port, []);
      // assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'), null, port, ["path=/"]);
    }
  }
}

spawn named 'peerDiscovery' {
  console.info('Peer discovery running');
  // during M.DefaultGateway($gwif, _) {
  //   on start console.log('GW+', gwif);
  //   on stop  console.log('GW-', gwif);
    during M.Discovered(
      M.Service($name, '_syndicate+ws._tcp'), $host, $port, $txt, $addr, "IPv4", $gwif)
    {
      const [dsId, peerId] = name.split(':');

      let tier = null;
      txt.forEach((t) => {
        t.split(' ').forEach((kv) => {
          const [k, v] = kv.split('=');
          if (k === 'tier') {
            tier = Number.parseInt(v);
          }
        });
      });

      on start console.log('+ws', gwif, tier, name, host, port, addr);
      on stop  console.log('-ws', gwif, tier, name, host, port, addr);
    }
  // }
}
