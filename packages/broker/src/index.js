"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const Tcp = activate require("@syndicate-lang/driver-tcp-node");
import {
  Set, Bytes,
  Encoder, Observe,
  Dataspace, Skeleton, currentFacet,
} from "@syndicate-lang/core";

const server = Http.HttpServer(null, 8000);

assertion type ConnectionName(scope, id);
assertion type Connection(connId);
message type Request(connId, body);
message type Response(connId, body);

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
        <div>
          <p>Hello</p>
        </div>
      ));
  }
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
  }
}

spawn named 'tcpListener' {
  during Tcp.TcpConnection($id, Tcp.TcpListener(8001)) spawn named ['tcpConnection', id] {
    const name = ConnectionName(scope, id);
    assert Tcp.TcpAccepted(id);
    assert Connection(name);
    const decoder = makeDecoder(null);
    on message Tcp.DataIn(id, $data) {
      decoder.write(data);
      let v;
      while ((v = decoder.try_next())) {
        send Request(name, v);
      }
    }
    on message Response(name, $resp) send Tcp.DataOut(id, new Encoder().push(resp).contents());
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
