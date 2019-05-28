"use strict";

assertion type AvailableTransport(spec);
assertion type WebSocketTransport(port, path);
// S.TcpListener specifies TCP transport
// S.UnixSocketServer specifies Unix socket transport

Object.assign(module.exports, {
  AvailableTransport,
  WebSocketTransport,
});
