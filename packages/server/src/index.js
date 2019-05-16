"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");

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

assertion type Connection(connId);
message type Request(connId, body);
message type Response(connId, body);

message type Disconnect(connId);

// Internal isolation
assertion type Proposal(scope, body);
assertion type Envelope(scope, body);

// Monitoring
assertion type ConnectionScope(connId, scope);

const {
  Connect, Peer,
  Assert, Clear, Message,
  Add, Del, Msg, Err,
  makeDecoder,
} = activate require("./protocol");

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

  during ConnectionScope($connId, $scope) assert Envelope('monitor', ConnectionScope(connId, scope));
  on message Envelope('monitor', Disconnect($connId)) send Disconnect(connId);
}

spawn named 'websocketListener' {
  assert M.Publish(M.Service(gatewayId, '_syndicate+ws._tcp'),
                   null, HTTP_PORT, ["tier=0", "path=/broker"]);
  assert M.Publish(M.Service(localId, '_syndicate+ws._tcp'),
                   null, HTTP_PORT, ["tier=0", "path=/monitor"]);

  during Http.WebSocket($reqId, server, [], _) spawn named ['wsConnection', reqId] {
    assert Connection(reqId);
    on message Http.DataIn(reqId, $data) {
      if (data instanceof Bytes) {
        send Request(reqId, makeDecoder(data).next());
      }
    }
    on message Response(reqId, $resp) send Http.DataOut(reqId, new Encoder().push(resp).contents());
    stop on message Disconnect(reqId);
  }
}

spawn named 'tcpListener' {
  assert M.Publish(M.Service(gatewayId, '_syndicate._tcp'), null, TCP_PORT, ["tier=0"]);
  on asserted S.IncomingConnection($id, S.TcpListener(TCP_PORT)) {
    spawnStreamConnection('tcpServer', id);
  }
}

spawn named 'unixListener' {
  on asserted S.IncomingConnection($id, S.UnixSocketServer("./sock")) {
    spawnStreamConnection('unixServer', id);
  }
}

function spawnStreamConnection(debugLabel, id) {
  spawn named [debugLabel, id] {
    stop on retracted S.Duplex(id);
    assert Connection(id);
    const decoder = makeDecoder(null);
    on message S.Data(id, $data) {
      decoder.write(data);
      let v;
      while ((v = decoder.try_next())) {
        send Request(id, v);
      }
    }
    on message Response(id, $resp) send S.Push(id, new Encoder().push(resp).contents(), null);
    stop on message Disconnect(id);
  }
}

spawn named 'connectionHandler' {
  during Proposal($scope, $assertion) assert Envelope(scope, assertion);
  on message Proposal($scope, $assertion) send Envelope(scope, assertion);

  during Connection($connId) spawn named Connection(connId) {
    on start console.log(connId.toString(), 'connected');
    on stop console.log(connId.toString(), 'disconnected');

    field this.scope = null;
    assert ConnectionScope(connId, this.scope) when (this.scope !== null);

    let endpoints = Set();

    on message Request(connId, Connect($scope)) {
      // TODO: Enforce requirement that Connect appear exactly once, before anything else
      this.scope = scope;
    }

    on message Request(connId, Assert($ep, $a)) {
      if (!endpoints.includes(ep)) {
        endpoints = endpoints.add(ep);
        react {
          on stop { endpoints = endpoints.remove(ep); }

          field this.assertion = a;
          assert Proposal(this.scope, this.assertion);

          currentFacet().addEndpoint(() => {
            if (Observe.isClassOf(this.assertion)) {
              const spec = Envelope(this.scope, this.assertion.get(0));
              const analysis = Skeleton.analyzeAssertion(spec);
              analysis.callback = Dataspace.wrap((evt, vs) => {
                currentFacet().actor.scheduleScript(() => {
                  console.log('EVENT', currentFacet().toString(), connId.toString(), ep, evt, vs);
                  switch (evt) {
                    case Skeleton.EVENT_ADDED:
                      send Response(connId, Add(ep, vs));
                      break;
                    case Skeleton.EVENT_REMOVED:
                      send Response(connId, Del(ep, vs));
                      break;
                    case Skeleton.EVENT_MESSAGE:
                      send Response(connId, Msg(ep, vs));
                      break;
                  }
                });
              });
              return [Observe(spec), analysis];
            } else {
              return [void 0, null];
            }
          }, true);

          on message Request(connId, Assert(ep, $newAssertion)) this.assertion = newAssertion;
          stop on message Request(connId, Clear(ep));
        }
      }
    }

    on message Request(connId, Message($body)) {
      send Proposal(this.scope, body);
    }

    on message Request(connId, $req) console.log('IN: ', connId.toString(), req.toString());
    on message Response(connId, $resp) console.log('OUT:', connId.toString(), resp.toString());
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
