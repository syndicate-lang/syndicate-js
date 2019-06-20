"use strict";

const debugFactory = require('debug');

import {
  Decoder, Encoder, Bytes, Map,
  Observe, Skeleton,
  genUuid, currentFacet,
} from "@syndicate-lang/core";

const WS = activate require("@syndicate-lang/driver-websocket");

const {
  Connect, Peer,
  Turn,
  Assert, Clear, Message,
  Add, Del, Msg, Err, End,
  Ping, Pong,
  makeDecoder,
  shouldDebugPrint,
} = activate require("./protocol");
const P = activate require("./internal_protocol");
const { recorder } = activate require("./turn");
const { heartbeat } = activate require("./heartbeat");

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

export function _genericClientSessionFacet(addr, scope, w0, teardown, debug) {
  if (debug === void 0) {
    debug = debugFactory('syndicate/server:client:' + genUuid('?'));
  }

  assert ServerConnected(addr);

  on start debug('+', addr.toString(), scope);
  on stop debug('-', addr.toString(), scope);
  on message _ServerPacket(addr, $m) if (shouldDebugPrint(m)) debug('<', m.toString());

  const w = (x) => {
    if (shouldDebugPrint(x)) debug('>', x.toString());
    w0(x);
  };

  const outboundTurn = recorder(this, 'commitNeeded', (items) => w(Turn(items)));

  field this.pubs = Map();
  field this.subs = Map();
  field this.matches = Map();

  on start w(Connect(scope));
  on stop this.matches.forEach((m) => {
    m.captures.forEach((a) => currentFacet().actor.adhocRetract(a));
  });

  on asserted ToServer(addr, $a) {
    const ep = genUuid('pub');
    outboundTurn.extend(Assert(ep, a));
    this.pubs = this.pubs.set(a, ep);
  }

  on retracted ToServer(addr, $a) {
    const ep = this.pubs.get(a);
    outboundTurn.extend(Clear(ep));
    this.pubs = this.pubs.remove(a);
  }

  on message ToServer(addr, $a) {
    outboundTurn.extend(Message(a));
  }

  on message _ServerPacket(addr, Ping()) w(Pong());

  on asserted Observe(FromServer(addr, $spec)) {
    const ep = genUuid('sub');
    outboundTurn.extend(Assert(ep, Observe(spec)));
    this.subs = this.subs.set(spec, ep);
    this.matches = this.matches.set(ep, { spec, captures: Map() });
  }

  on retracted Observe(FromServer(addr, $spec)) {
    outboundTurn.extend(Clear(this.subs.get(spec)));
    this.subs = this.subs.remove(spec);
  }

  const resetHeartbeat = heartbeat(this, ['client', addr, scope], w, teardown);
  on message _ServerPacket(addr, _) resetHeartbeat();

  const _instantiate = (m, vs) => Skeleton.instantiateAssertion(FromServer(addr, m.spec), vs);

  const _lookup = (CTOR, item) => {
    const m = this.matches.get(CTOR._endpointName(item));
    const vs = CTOR._captures(item);
    return { m, vs };
  }

  on message _ServerPacket(addr, Turn($items)) {
    items.forEach((item) => {
      if (Add.isClassOf(item)) {
        const { m, vs } = _lookup(Add, item);
        const a = _instantiate(m, vs);
        m.captures = m.captures.set(vs, a);
        currentFacet().actor.adhocAssert(a);
      } else if (Del.isClassOf(item)) {
        const { m, vs } = _lookup(Del, item);
        currentFacet().actor.adhocRetract(m.captures.get(vs));
        m.captures = m.captures.remove(vs);
      } else if (Msg.isClassOf(item)) {
        const { m, vs } = _lookup(Msg, item);
        send _instantiate(m, vs);
      } else if (End.isClassOf(item)) {
        const ep = End._endpointName(item);
        const m = this.matches.get(ep);
        if (m) {
          m.captures.forEach((a) => currentFacet().actor.adhocRetract(a));
          this.matches = this.matches.remove(ep);
        }
      } else if (Err.isClassOf(item)) {
        throw new Error(item.toString());
      } else {
        debug("Unhandled client/server message", item.toString());
      }
    });
  }
}

spawn named "ServerClientFactory" {
  during ToServer($addr, _) assert ServerConnection(addr);
  during Observe(FromServer($addr, _)) assert ServerConnection(addr);
  during Observe(ServerConnected($addr)) assert ServerConnection(addr);

  during ServerConnection($addr(WSServer($url, $scope))) spawn named ['ServerClient', addr] {
    const reestablish = () => {
      react {
        const establishingFacet = currentFacet();
        const wsId = genUuid('ws');

        during WS.WebSocket(wsId, url, {}) {
          on message WS.DataIn(wsId, $data) {
            if (data instanceof Bytes) send _ServerPacket(addr, makeDecoder(data).next());
          }

          _genericClientSessionFacet.call(
            this,
            addr, scope,
            (x) => { send WS.DataOut(wsId, new Encoder().push(x).contents()); },
            () => {
              establishingFacet.stop(() => {
                // TODO: abstract this into a flush() function somewhere
                const ACK = Symbol('ACK');
                react {
                  stop on message ACK reestablish();
                  on start send ACK;
                }
              });
            },
            debugFactory('syndicate/server:client:' + wsId));
        }
      }
    };

    on start reestablish();
  }

  during ServerConnection($addr(Loopback($scope))) spawn named ['ServerClient', addr] {
    const debug = debugFactory('syndicate/server:client:loopback:' + scope);
    assert P.POA(addr);
    on message P.ToPOA(addr, $p) send _ServerPacket(addr, p);
    on start react {
      stop on asserted Observe(P.FromPOA(addr, _)) {
        react _genericClientSessionFacet.call(
          this,
          addr, scope,
          (x) => { send P.FromPOA(addr, x); },
          () => { throw new Error("Cannot teardown and reset Loopback connection"); },
          debug);
      }
    }
  }
}
