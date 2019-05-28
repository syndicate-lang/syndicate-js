"use strict";

import {
  Decoder, Encoder, Bytes,
  Observe, Skeleton,
  genUuid,
} from "@syndicate-lang/core";

const WS = activate require("@syndicate-lang/driver-websocket");

const {
  Connect, Peer,
  Assert, Clear, Message,
  Add, Del, Msg, Err,
  Ping, Pong,
  makeDecoder,
} = activate require("./protocol");

assertion type WSServer(url, scope) = Symbol.for('server-websocket-connection');

assertion type ToServer(addr, assertion);
assertion type FromServer(addr, assertion);
assertion type ServerConnection(addr);
assertion type ServerConnected(addr);
message type ForceServerDisconnect(addr);

message type _ServerPacket(addr, packet);

Object.assign(module.exports, {
  WSServer,
  ToServer, FromServer,
  ServerConnection, ServerConnected,
  ForceServerDisconnect,
});

spawn named "ServerClientFactory" {
  during ToServer($addr, _) assert ServerConnection(addr);
  during Observe(FromServer($addr, _)) assert ServerConnection(addr);
  during Observe(ServerConnected($addr)) assert ServerConnection(addr);

  during ServerConnection($addr(WSServer($url, $scope))) spawn named ['Server', addr] {
    const wsId = genUuid('server');

    during WS.WebSocket(wsId, url, {}) {
      assert ServerConnected(addr);

      function w(x) {
        send WS.DataOut(wsId, new Encoder().push(x).contents());
      }

      on start w(Connect(scope));

      on message WS.DataIn(wsId, $data) {
        if (data instanceof Bytes) {
          send _ServerPacket(addr, makeDecoder(data).next());
        }
      }

      during ToServer(addr, $a) {
        const ep = genUuid('pub');
        on start w(Assert(ep, a));
        on stop w(Clear(ep));
      }

      on message ToServer(addr, $a) w(Message(a));

      on message _ServerPacket(addr, Ping()) w(Pong());

      during Observe(FromServer(addr, $spec)) {
        const ep = genUuid('sub');
        on start w(Assert(ep, Observe(spec)));
        on stop w(Clear(ep));
        on message _ServerPacket(addr, Add(ep, $vs)) {
          react {
            assert Skeleton.instantiateAssertion(FromServer(addr, spec), vs);
            stop on message _ServerPacket(addr, Del(ep, vs));
          }
        }
        on message _ServerPacket(addr, Msg(ep, $vs)) {
          send Skeleton.instantiateAssertion(FromServer(addr, spec), vs);
        }
      }
    }
  }
}
