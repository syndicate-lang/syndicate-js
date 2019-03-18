"use strict";

import {
  Decoder, Encoder, Bytes,
  Observe, Skeleton,
  genUuid,
} from "@syndicate-lang/core";

const WS = activate require("@syndicate-lang/driver-websocket");

const {
  Assert, Clear, Message,
  Add, Del, Msg,
  Ping, Pong,
  makeDecoder,
} = activate require("./protocol");

assertion type ToBroker(url, assertion);
assertion type FromBroker(url, assertion);
assertion type BrokerConnection(url);
assertion type BrokerConnected(url);
message type ForceBrokerDisconnect(url);

message type _BrokerPacket(url, packet);

Object.assign(module.exports, {
  ToBroker, FromBroker,
  BrokerConnection, BrokerConnected,
  ForceBrokerDisconnect,
});

spawn named "BrokerClientFactory" {
  during ToBroker($url, _) assert BrokerConnection(url);
  during Observe(FromBroker($url, _)) assert BrokerConnection(url);
  during Observe(BrokerConnected($url)) assert BrokerConnection(url);

  during BrokerConnection($url) spawn named ['Broker', url] {
    const wsId = genUuid('broker');

    during WS.WebSocket(wsId, url, {}) {
      assert BrokerConnected(url);

      function w(x) {
        send WS.DataOut(wsId, new Encoder().push(x).contents());
      }
      on message WS.DataIn(wsId, $data) {
        if (data instanceof Bytes) {
          send _BrokerPacket(url, makeDecoder(data).next());
        }
      }

      during ToBroker(url, $a) {
        const ep = genUuid('pub');
        on start w(Assert(ep, a));
        on stop w(Clear(ep));
      }

      on message ToBroker(url, $a) w(Message(a));

      on message _BrokerPacket(url, Ping()) w(Pong());

      during Observe(FromBroker(url, $spec)) {
        const ep = genUuid('sub');
        on start w(Assert(ep, Observe(spec)));
        on stop w(Clear(ep));
        on message _BrokerPacket(url, Add(ep, $vs)) {
          react {
            assert Skeleton.instantiateAssertion(FromBroker(url, spec), vs);
            stop on message _BrokerPacket(url, Del(ep, vs));
          }
        }
        on message _BrokerPacket(url, Msg(ep, $vs)) {
          send Skeleton.instantiateAssertion(FromBroker(url, spec), vs);
        }
      }
    }
  }
}
