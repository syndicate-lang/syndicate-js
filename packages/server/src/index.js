"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const C = activate require("./client");
const P = activate require("./internal_protocol");
const D = activate require("./disco");
const Server = activate require("./server");
const Federation = activate require("./federation");
const fs = require('fs');

import {
  RandomID,
} from "@syndicate-lang/core";

let currentManagementScope = 'local';

function usage() {
             // --------------------------------------------------------------------------------
  console.info('Usage: syndicate-server [ OPTION [ OPTION ... ] ]');
  console.info('');
  console.info('where OPTION may be repeated any number of times and is drawn from:');
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
  console.info('  --overlay OVERLAYID WEBSOCKETURL');
  console.info('                        Participate in a self-assembling overlay with the');
  console.info('                        given ID and root node server URL');
  console.info('');
  console.info('  --help, -h            Produce this message and terminate');
}

const uplinks = [];
const overlays = [];
function process_command_line(args) {
  const notUndefined = (x, w) => {
    if (x === void 0) {
      console.error('Missing '+w+' argument on command line');
      usage();
      process.exit(1);
    }
    return x;
  };
  const strArg = (w) => notUndefined(args.shift(), w);
  const numArg = (w) => Number.parseInt(notUndefined(args.shift(), w));
  while (args.length) {
    const opt = args.shift();
    switch (opt) {
      case "--tcp": spawnTcpServer(numArg('TCP port')); break;
      case "--http": spawnWebSocketServer(numArg('HTTP port')); break;
      case "--unix": spawnUnixSocketServer(strArg('Unix socket path')); break;
      case "--monitor": spawnMonitorAppServer(numArg('monitor HTTP port')); break;
      case "--management": currentManagementScope = strArg('management scope'); break;
      case "--uplink": {
        const localScope = strArg('local scope');
        const target = strArg('remote WebSocket URL');
        const remoteScope = strArg('remote scope');
        uplinks.push(Federation.Uplink(localScope,
                                       C.WSServer(target, currentManagementScope),
                                       remoteScope));
        break;
      }
      case "--overlay": {
        const overlayId = strArg('overlay id');
        const rootUrl = strArg('overlay root WebSocket URL');
        overlays.push(D.Overlay(overlayId, C.WSServer(rootUrl, currentManagementScope)));
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

process_command_line(process.argv.slice(2));

spawn named 'server' {
  assert Federation.ManagementScope(currentManagementScope);
  uplinks.forEach((link) => {
    assert P.Proposal(currentManagementScope, link);
  });
  if (overlays.length > 0) {
    const localId = RandomID.randomId(8, false);
    assert D.OverlayNode(localId);
  }
  overlays.forEach((o) => {
    assert P.Proposal(currentManagementScope, o);
  });
}

function _spawnStreamServer(spec) {
  spawn named spec {
    assert D.AvailableTransport(spec);
    on asserted S.Stream($id, S.Incoming(spec)) Server.streamServerActor(id, [spec, id]);
  }
}

function spawnTcpServer(port) {
  _spawnStreamServer(S.TcpListener(port));
}

function spawnUnixSocketServer(path) {
  _spawnStreamServer(S.UnixSocketServer(path));
}

function spawnWebSocketServer(port) {
  const spec = D.WebSocketTransport(port, '/');
  spawn named spec {
    const server = Http.HttpServer(null, port);
    assert D.AvailableTransport(spec);
    during Http.WebSocket($reqId, server, [], _) spawn named [spec, reqId] {
      Server.websocketServerFacet(reqId);
    }
  }
}

function spawnMonitorAppServer(port) {
  console.info('Monitor app on port', port);
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
