"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");
const P = activate require("./internal_protocol");
const C = activate require("./client");
const Server = activate require("./server");
const Federation = activate require("./federation");

import {
  Set, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet, genUuid, RandomID
} from "@syndicate-lang/core";

const fs = require('fs');

let currentManagementScope = 'local';

function usage() {
             // --------------------------------------------------------------------------------
  console.info('Usage: syndicate-server [ OPTION [ OPTION ... ] ]');
  console.info('');
  console.info('where OPTION may be repeated any number of times and is drawn from:');
  console.info('');
  console.info('  --advertise           Enable mDNS advertisement for subsequent services');
  console.info('  --no-advertise        Disable mDNS advertisement for subsequent services');
  console.info('');
  console.info('  --tcp PORTNUMBER      Create a plain TCP service on the given port');
  console.info('  --http PORTNUMBER     Create an HTTP WebSocket service on the given port');
  console.info('  --unix PATH           Create a Unix socket service at the given path');
  console.info('');
  console.info('  --monitor PORTNUMBER  Serve a simple HTML/JS monitoring app on the port');
  console.info('');
  console.info('  --management SCOPE    Set the management scope for --uplink etc to use');
  console.info('  --uplink LOCALSCOPE WEBSOCKETURL REMOTESCOPE');
  console.info('                        Establish a federation uplink from the named local');
  console.info('                        scope to the remote scope within the server at the URL');
  console.info('');
  console.info('mDNS advertisement starts out enabled.');
}

const uplinks = [];
function process_command_line(args) {
  const strArg = () => args.shift();
  const numArg = () => Number.parseInt(args.shift());
  let advertise = true;
  while (args.length) {
    const opt = args.shift();
    switch (opt) {
      case "--advertise": advertise = true; break;
      case "--no-advertise": advertise = false; break;
      case "--tcp": spawnTcpServer(numArg(), advertise); break;
      case "--http": spawnWebSocketServer(numArg(), advertise); break;
      case "--unix": spawnUnixSocketServer(strArg(), advertise); break;
      case "--monitor": spawnMonitorAppServer(numArg(), advertise); break;
      case "--management": currentManagementScope = strArg(); break;
      case "--uplink": {
        const localScope = strArg();
        const target = strArg();
        const remoteScope = strArg();
        uplinks.push(Federation.Uplink(localScope,
                                       C.WSServer(target, currentManagementScope),
                                       remoteScope));
        break;
      }
      default:
        console.error("Unsupported command-line argument: " + opt);
        /* FALL THROUGH */
      case '--help':
      case '-h':
        usage();
        process.exit(1);
    }
  }
}

const localId = RandomID.randomId(8, false);
const dataspaceId = 'EToUNUJI0ykSfudmN9Z99wu62qGQB1nd8SHvjNtL5tM'; // public key of root server
const gatewayId = dataspaceId + ':' + localId;

process_command_line(process.argv.slice(2));

spawn named 'server' {
  assert Federation.ManagementScope(currentManagementScope);
  uplinks.forEach((link) => {
    assert P.Proposal(currentManagementScope, link);
  });
}

function spawnTcpServer(port, advertise) {
  spawn named ['tcpServer', port] {
    if (advertise) {
      assert M.Publish(M.Service(gatewayId, '_syndicate._tcp'), null, port, ["tier=0"]);
    }
    on asserted S.IncomingConnection($id, S.TcpListener(port)) {
      Server.streamServerActor(id, ['tcpServer', port, id]);
    }
  }
}

function spawnWebSocketServer(port, advertise) {
  spawn named ['wsConnection', port] {
    const server = Http.HttpServer(null, port);
    if (advertise) {
      assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'), null, port,
                       ["tier=0", "path=/local"]);
      assert M.Publish(M.Service(localId, '_syndicate+ws._tcp'), null, port,
                       ["tier=0", "path=/monitor"]);
    }
    during Http.WebSocket($reqId, server, [], _) spawn named ['wsConnection', port, reqId] {
      Server.websocketServerFacet(reqId);
    }
  }
}

function spawnUnixSocketServer(path) {
  spawn named ['unixServer', path] {
    on asserted S.IncomingConnection($id, S.UnixSocketServer(path)) {
      Server.streamServerActor(id, ['unixServer', path, id]);
    }
  }
}

function spawnMonitorAppServer(port) {
  spawn named ['monitorAppServer', port] {
    const server = Http.HttpServer(null, port);

    during Http.Request($reqId, server, 'get', [], _, _) {
      assert :snapshot Http.Response(reqId, 200, "OK", {"Content-type": "text/html"},
                                     '<!DOCTYPE html>' + UI.htmlToString(
                                         <html>
                                           <head><meta charset="utf-8"></meta></head>
                                           <body><script src="dist/monitor.js"></script></body>
                                         </html>));
    }

    function assertFileResponse(reqId, path) {
      assert :snapshot Http.Response(reqId, 200, "OK", {}, fs.readFileSync(path));
    }

    during Http.Request($reqId, server, 'get', ['chat.html'], _, _)
      assertFileResponse(reqId, __dirname + '/../chat.html');

    during Http.Request($reqId, server, 'get', ['style.css'], _, _)
      assertFileResponse(reqId, __dirname + '/../style.css');

    during Http.Request($reqId, server, 'get', ['dist', $file], _, _)
      assertFileResponse(reqId, __dirname + '/../dist/' + file);
  }
}

spawn named 'monitorApp' {
  during P.POAScope($connId, $scope) assert P.Proposal('monitor', P.POAScope(connId, scope));
  on message P.Envelope('monitor', P.Disconnect($connId)) send P.Disconnect(connId);
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
