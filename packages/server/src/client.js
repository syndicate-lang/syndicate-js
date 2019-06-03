"use strict";

const debugFactory = require('debug');

import {
  Decoder, Encoder, Bytes,
  Observe, Skeleton,
  genUuid, currentFacet,
} from "@syndicate-lang/core";

const WS = activate require("@syndicate-lang/driver-websocket");

const {
  Connect, Peer,
  Commit,
  Assert, Clear, Message,
  Add, Del, Msg, Err,
  Ping, Pong,
  makeDecoder,
} = activate require("./protocol");
const P = activate require("./internal_protocol");
const Turn = activate require("./turn");

assertion type WSServer(url, scope) = Symbol.for('server-websocket-connection');
assertion type Loopback(scope) = Symbol.for('server-loopback-connection');

assertion type ToServer(addr, assertion);
assertion type FromServer(addr, assertion);
assertion type ServerConnection(addr);
assertion type ServerConnected(addr);
message type ForceServerDisconnect(addr);

message type _ServerPacket(addr, packet);

Object.assign(module.exports, {
  WSServer, Loopback,
  ToServer, FromServer,
  ServerConnection, ServerConnected,
  ForceServerDisconnect,
});

export function _genericClientSessionFacet(addr, scope, w0, debug) {
  if (debug === void 0) {
    debug = debugFactory('syndicate/server:client:' + genUuid('?'));
  }

  assert ServerConnected(addr);

  on start debug('+', addr.toString(), scope);
  on stop debug('-', addr.toString(), scope);
  on message _ServerPacket(addr, $m) debug('<', m.toString());

  const w = (x) => {
    debug('>', x.toString());
    w0(x);
  };

  const outboundTurn = Turn.recorder(this, 'commitNeeded',
                                     {
                                       extend: w,
                                       commit: () => { w(Commit()); },
                                       debug: debug
                                     });
  const inboundTurn = Turn.replayer({ debug: debug });

  on start w(Connect(scope));

  during ToServer(addr, $a) {
    const ep = genUuid('pub');
    on start outboundTurn.extend(Assert(ep, a));
    on stop outboundTurn.extend(Clear(ep));
  }

  on message ToServer(addr, $a) outboundTurn.extend(Message(a));

  on message _ServerPacket(addr, Ping()) w(Pong());

  during Observe(FromServer(addr, $spec)) {
    const ep = genUuid('sub');
    on start outboundTurn.extend(Assert(ep, Observe(spec)));
    on stop outboundTurn.extend(Clear(ep));
    on message _ServerPacket(addr, Add(ep, $vs)) inboundTurn.extend(() => {
      react {
        const epFacet = currentFacet();
        assert Skeleton.instantiateAssertion(FromServer(addr, spec), vs);
        on message _ServerPacket(addr, Del(ep, vs)) inboundTurn.extend(() => {
          epFacet.stop();
        });
      }
    })
    on message _ServerPacket(addr, Msg(ep, $vs)) inboundTurn.extend(() => {
      send Skeleton.instantiateAssertion(FromServer(addr, spec), vs);
    })
    on message _ServerPacket(addr, Commit()) inboundTurn.commit();
  }
}

spawn named "ServerClientFactory" {
  during ToServer($addr, _) assert ServerConnection(addr);
  during Observe(FromServer($addr, _)) assert ServerConnection(addr);
  during Observe(ServerConnected($addr)) assert ServerConnection(addr);

  during ServerConnection($addr(WSServer($url, $scope))) spawn named ['Server', addr] {
    const wsId = genUuid('server');
    const debug = debugFactory('syndicate/server:client:' + wsId);

    during WS.WebSocket(wsId, url, {}) {
      on message WS.DataIn(wsId, $data) {
        if (data instanceof Bytes) send _ServerPacket(addr, makeDecoder(data).next());
      }

      _genericClientSessionFacet.call(
        this,
        addr, scope,
        (x) => { send WS.DataOut(wsId, new Encoder().push(x).contents()); },
        debug);
    }
  }

  during ServerConnection($addr(Loopback($scope))) spawn named ['Server', addr] {
    const debug = debugFactory('syndicate/server:client:loopback:' + scope);
    assert P.POA(addr);
    on message P.ToPOA(addr, $p) send _ServerPacket(addr, p);
    on start react {
      stop on asserted Observe(P.FromPOA(addr, _)) {
        react _genericClientSessionFacet.call(
          this,
          addr, scope,
          (x) => { send P.FromPOA(addr, x); },
          debug);
      }
    }
  }
}
