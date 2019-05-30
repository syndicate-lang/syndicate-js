"use strict";

assertion type ServerActive(scope) = Symbol.for('server-active');

assertion type POA(connId) = Symbol.for('server-poa');
assertion type POAReady(connId) = Symbol.for('server-poa-ready');
message type FromPOA(connId, body) = Symbol.for('message-poa->server');
message type ToPOA(connId, body) = Symbol.for('message-server->poa');

message type Disconnect(connId) = Symbol.for('disconnect-poa');

// Internal isolation
assertion type Proposal(scope, body) = Symbol.for('server-proposal');
assertion type Envelope(scope, body) = Symbol.for('server-envelope');

// Monitoring
assertion type POAScope(connId, scope) = Symbol.for('server-poa-scope');

// Federation
assertion type FederatedLink(id, scope) = Symbol.for('federated-link');
assertion type FederatedLinkReady(id) = Symbol.for('federated-link-ready');

Object.assign(module.exports, {
  ServerActive,
  POA, POAReady, FromPOA, ToPOA,
  Disconnect,
  Proposal, Envelope,
  POAScope,
  FederatedLink, FederatedLinkReady,
});
