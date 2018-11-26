"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");

import {
  Set, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet,
} from "@syndicate-lang/core";

const server = Http.HttpServer(null, 8000);

const fs = require('fs');

assertion type ConnectionName(scope, id);
assertion type Connection(connId);
message type Request(connId, body);
message type Response(connId, body);

message type Disconnect(connId);

// Internal isolation
assertion type Envelope(scope, body);

const {
  Assert, Clear, Message,
  Add, Del, Msg,
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

  during Http.Request($reqId, server, 'get', ['dist', $file], _, _) {
    const contents = fs.readFileSync(__dirname + '/../dist/' + file);
    assert :snapshot Http.Response(reqId, 200, "OK", {}, contents);
  }

  during Connection($name) assert Envelope('monitor', Connection(name));
  on message Envelope('monitor', Disconnect($name)) send Disconnect(name);
}

spawn named 'websocketListener' {
  during Http.WebSocket($reqId, server, [$scope], _) spawn named ['wsConnection', scope, reqId] {
    const name = ConnectionName(scope, reqId);
    assert Connection(name);
    on message Http.DataIn(reqId, $data) {
      if (data instanceof Bytes) {
        send Request(name, makeDecoder(data).next());
      }
    }
    on message Response(name, $resp) send Http.DataOut(reqId, new Encoder().push(resp).contents());
    stop on message Disconnect(name);
  }
}

spawn named 'tcpListener' {
  on asserted S.IncomingConnection($id, S.TcpListener(8001)) {
    spawnStreamConnection('tcpBroker', id);
  }
}

spawn named 'unixListener' {
  on asserted S.IncomingConnection($id, S.UnixSocketServer("./sock")) {
    spawnStreamConnection('unixBroker', id);
  }
}

function spawnStreamConnection(debugLabel, id) {
  spawn named [debugLabel, id] {
    stop on retracted S.Duplex(id);
    const name = ConnectionName('broker', id);
    assert Connection(name);
    const decoder = makeDecoder(null);
    on message S.Data(id, $data) {
      decoder.write(data);
      let v;
      while ((v = decoder.try_next())) {
        send Request(name, v);
      }
    }
    on message Response(name, $resp) send S.Push(id, new Encoder().push(resp).contents(), null);
    stop on message Disconnect(name);
  }
}

spawn named 'connectionHandler' {
  during Connection($connId(ConnectionName($scope,_))) spawn named Connection(connId) {
    on start console.log(connId.toString(), 'connected');
    on stop console.log(connId.toString(), 'disconnected');

    let endpoints = Set();

    on message Request(connId, Assert($ep, $a)) {
      if (!endpoints.includes(ep)) {
        endpoints = endpoints.add(ep);
        react {
          on stop { endpoints = endpoints.remove(ep); }

          field this.assertion = a;

          currentFacet().addEndpoint(() => {
            if (Observe.isClassOf(this.assertion)) {
              const spec = Envelope(scope, this.assertion.get(0));
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
              return [Envelope(scope, this.assertion), null];
            }
          }, true);

          on message Request(connId, Assert(ep, $newAssertion)) this.assertion = newAssertion;
          stop on message Request(connId, Clear(ep));
        }
      }
    }

    on message Request(connId, Message($body)) {
      send Envelope(scope, body);
    }

    on message Request(connId, $req) console.log('IN: ', connId.toString(), req.toString());
    on message Response(connId, $resp) console.log('OUT:', connId.toString(), resp.toString());
  }
}
