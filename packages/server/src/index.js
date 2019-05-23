"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");
const P = activate require("./internal_protocol");
const Server = activate require("./server");

import {
  Set, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet, genUuid, RandomID
} from "@syndicate-lang/core";

const HTTP_PORT = 8000;
const TCP_PORT = 8001;

const server = Http.HttpServer(null, HTTP_PORT);

const dataspaceId = 'EToUNUJI0ykSfudmN9Z99wu62qGQB1nd8SHvjNtL5tM'; // public key of root server
const localId = RandomID.randomId(8, false);
const gatewayId = dataspaceId + ':' + localId;

const fs = require('fs');

spawn named 'serverLogger' {
  on asserted Http.Request(_, server, $method, $path, $query, $req) {
    console.log(method, path.toJS(), query.toJS());
  }
  on asserted Http.WebSocket(_, server, $path, $query) {
    console.log(path.toJS(), query.toJS());
  }
}

spawn named 'rootServer' {
  during Http.Request($reqId, server, 'get', [], _, _) {
    assert :snapshot Http.Response(
      reqId, 200, "OK", {"Content-type": "text/html"},
      '<!DOCTYPE html>' + UI.htmlToString(
        <html>
          <head>
            <meta charset="utf-8"></meta>
          </head>
          <body>
            <script src="dist/monitor.js"></script>
          </body>
        </html>
      ));
  }

  during Http.Request($reqId, server, 'get', ['chat.html'], _, _) {
    const contents = fs.readFileSync(__dirname + '/../chat.html');
    assert :snapshot Http.Response(reqId, 200, "OK", {}, contents);
  }

  during Http.Request($reqId, server, 'get', ['style.css'], _, _) {
    const contents = fs.readFileSync(__dirname + '/../style.css');
    assert :snapshot Http.Response(reqId, 200, "OK", {}, contents);
  }

  during Http.Request($reqId, server, 'get', ['dist', $file], _, _) {
    const contents = fs.readFileSync(__dirname + '/../dist/' + file);
    assert :snapshot Http.Response(reqId, 200, "OK", {}, contents);
  }

  during P.POAScope($connId, $scope) assert P.Envelope('monitor', P.POAScope(connId, scope));
  on message P.Envelope('monitor', P.Disconnect($connId)) send P.Disconnect(connId);
}

spawn named 'websocketListener' {
  assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'),
                   null, HTTP_PORT, ["tier=0", "path=/local"]);
  assert M.Publish(M.Service(localId, '_syndicate+ws._tcp'),
                   null, HTTP_PORT, ["tier=0", "path=/monitor"]);

  during Http.WebSocket($reqId, server, [], _) spawn named ['wsConnection', reqId] {
    Server.websocketServerFacet(reqId);
  }
}

spawn named 'tcpListener' {
  assert M.Publish(M.Service(gatewayId, '_syndicate._tcp'), null, TCP_PORT, ["tier=0"]);
  on asserted S.IncomingConnection($id, S.TcpListener(TCP_PORT)) {
    Server.streamServerActor(id, 'tcpServer');
  }
}

spawn named 'unixListener' {
  on asserted S.IncomingConnection($id, S.UnixSocketServer("./sock")) {
    Server.streamServerActor(id, 'unixServer');
  }
}

spawn named 'peerDiscovery' {
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

  /*

If there's a server on our gateway interface, see if it's better than us.
  - if it is, use it.
  - if it's not, pretend it isn't there.

If there's no server on our gateway interface (or we're pretending
none exists), try to connect to the top.

   */
}
