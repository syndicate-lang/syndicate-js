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

assertion type WSBroker(url, scope);

assertion type ToBroker(addr, assertion);
assertion type FromBroker(addr, assertion);
assertion type BrokerConnection(addr);
assertion type BrokerConnected(addr);
message type ForceBrokerDisconnect(addr);

message type _BrokerPacket(addr, packet);

Object.assign(module.exports, {
  WSBroker,
  ToBroker, FromBroker,
  BrokerConnection, BrokerConnected,
  ForceBrokerDisconnect,
});

spawn named "BrokerClientFactory" {
  during ToBroker($addr, _) assert BrokerConnection(addr);
  during Observe(FromBroker($addr, _)) assert BrokerConnection(addr);
  during Observe(BrokerConnected($addr)) assert BrokerConnection(addr);

  during BrokerConnection($addr(WSBroker($url, $scope))) spawn named ['Broker', addr] {
    const wsId = genUuid('broker');

    during WS.WebSocket(wsId, url, {}) {
      assert BrokerConnected(addr);

      function w(x) {
        send WS.DataOut(wsId, new Encoder().push(x).contents());
      }

      on start w(Connect(scope));

      on message WS.DataIn(wsId, $data) {
        if (data instanceof Bytes) {
          send _BrokerPacket(addr, makeDecoder(data).next());
        }
      }

      during ToBroker(addr, $a) {
        const ep = genUuid('pub');
        on start w(Assert(ep, a));
        on stop w(Clear(ep));
      }

      on message ToBroker(addr, $a) w(Message(a));

      on message _BrokerPacket(addr, Ping()) w(Pong());

      during Observe(FromBroker(addr, $spec)) {
        const ep = genUuid('sub');
        on start w(Assert(ep, Observe(spec)));
        on stop w(Clear(ep));
        on message _BrokerPacket(addr, Add(ep, $vs)) {
          react {
            assert Skeleton.instantiateAssertion(FromBroker(addr, spec), vs);
            stop on message _BrokerPacket(addr, Del(ep, vs));
          }
        }
        on message _BrokerPacket(addr, Msg(ep, $vs)) {
          send Skeleton.instantiateAssertion(FromBroker(addr, spec), vs);
        }
      }
    }
  }
}
