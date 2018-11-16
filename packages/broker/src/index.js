"use strict";

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const Http = activate require("@syndicate-lang/driver-http-node");
const Tcp = activate require("@syndicate-lang/driver-tcp-node");
import { Decoder, Bytes } from "@syndicate-lang/core";

const server = Http.HttpServer(null, 8000);

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
  during Http.WebSocket($reqId, server, ['broker'], _) spawn named ['wsConnection', reqId] {
    on message Http.DataIn(reqId, $message) {
      console.log('got', reqId, new Decoder(message).next());
      send Http.DataOut(reqId, message);
    }

    stop on message Http.DataIn(reqId, Bytes.from("quit"));
  }
}

spawn named 'tcpListener' {
  during Tcp.TcpConnection($id, Tcp.TcpListener(8001)) spawn named ['tcpConnection', id] {
    assert Tcp.TcpAccepted(id);
    on message Tcp.DataIn(id, $data) {
      console.log('got', id, data);
      send Tcp.DataOut(id, data);
    }
  }
}

