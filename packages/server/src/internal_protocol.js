"use strict";

assertion type ServerActive(scope) = Symbol.for('server-active');

assertion type POA(connId) = Symbol.for('server-poa');
message type FromPOA(connId, body) = Symbol.for('message-poa->server');
message type ToPOA(connId, body) = Symbol.for('message-server->poa');

message type Disconnect(connId) = Symbol.for('disconnect-poa');

// Internal isolation
assertion type Proposal(scope, body) = Symbol.for('server-proposal');
assertion type Envelope(scope, body) = Symbol.for('server-envelope');

// Monitoring
assertion type POAScope(connId, scope) = Symbol.for('server-poa-scope');

Object.assign(module.exports, {
  ServerActive,
  POA, FromPOA, ToPOA,
  Disconnect,
  Proposal, Envelope,
  POAScope,
});
