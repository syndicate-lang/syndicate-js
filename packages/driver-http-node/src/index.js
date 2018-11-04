//---------------------------------------------------------------------------
// @syndicate-lang/driver-http-node, HTTP support for Syndicate/js
// Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

import { Seal, Observe, Dataspace, Skeleton } from "@syndicate-lang/core";
const { isCapture, captureName } = Skeleton;
import { parse as parseUrl } from "url";

const http = require('http');
const https = require('https');
const _WebSocket = require('ws');

assertion type HttpServer(host, port);
assertion type HttpsServer(host, port, options);

assertion type WebSocket(id, server, path, query);
assertion type Request(id, server, method, path, query, req);
message type RequestData(id, chunk);

assertion type Response(id, code, message, headers, detail);
message type ResponseData(id, chunk);

Object.assign(module.exports, {
  HttpServer, HttpsServer,
  WebSocket, Request, RequestData,
  Response, ResponseData,
});

spawn named 'HttpServerFactory' {
  during Observe(Request(_, HttpServer($h, $p), _, _, _, _)) assert HttpServer(h, p);
  during Observe(Request(_, HttpsServer($h, $p, $o), _, _, _, _)) assert HttpsServer(h, p, o);

  during HttpServer($host, $port) spawn named ['HttpServer', host, port] {
    _server.call(this, host, port, null);
  }
  during HttpsServer($host, $port, $options) spawn named ['HttpsServer', host, port] {
    _server.call(this, host, port, options);
  }
}

let nextId = 0;

function _server(host, port, httpsOptions) {
  const server = httpsOptions ? HttpsServer(host, port, httpsOptions) : HttpServer(host, port);

  const requestHandlerMap = {};
  const wsHandlerMap = {};

  function encodePath(path) {
    return JSON.stringify(path.toJS().map((s) => isCapture(s) ? null : s));
  }

  during Observe(Request(_, server, $method, $pathPattern, _, _)) {
    if (method.toLowerCase() !== method) {
      console.warn('HTTP method should be lowercase: ' + method);
    }
    const path = encodePath(pathPattern);
    on start {
      if (!(path in requestHandlerMap)) requestHandlerMap[path] = {_count: 0, _path: pathPattern};
      requestHandlerMap[path]._count++;
      if (!(method in requestHandlerMap[path])) requestHandlerMap[path][method] = 0;
      requestHandlerMap[path][method]++;
    }
    on stop {
      requestHandlerMap[path][method]--;
      if (requestHandlerMap[path][method] === 0) delete requestHandlerMap[path][method];
      requestHandlerMap[path]._count--;
      if (requestHandlerMap[path]._count === 0) delete requestHandlerMap[path];
    }
  }

  during Observe(WebSocket(_, server, $path, _)) {
    path = encodePath(path);
    on start {
      if (!(path in wsHandlerMap)) wsHandlerMap[path] = 0;
      wsHandlerMap[path]++;
    }
    on stop {
      wsHandlerMap[path]--;
      if (wsHandlerMap[path] === 0) delete wsHandlerMap[path];
    }
  }

  const s = httpsOptions ? https.createServer(httpsOptions) : http.createServer();
  const wss = new _WebSocket.Server({ server: s, verifyClient: checkWSConnection });

  function pathMatches(path, pieces) {
    if (path.length !== pieces.length) return false;
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== null && path[i] !== pieces[i]) {
        return false;
      }
    }
    return true;
  }

  function mapLookup(m, pieces) {
    for (let pathEnc in m) {
      if (pathMatches(JSON.parse(pathEnc), pieces)) {
        return m[pathEnc];
      }
    }
    return null;
  }

  function reqUrlPieces(url) {
    let pieces = url.pathname.split(/\//);
    while (pieces[0] === '') pieces.shift();
    while (pieces.length && pieces[pieces.length - 1] === '') pieces.pop();
    return pieces;
  }

  s.on('request', Dataspace.wrapExternal((req, res) => {
    let url = parseUrl(req.url, true);
    let pieces = reqUrlPieces(url);
    let methodMap = mapLookup(requestHandlerMap, pieces);
    if (!methodMap) {
      res.writeHead(404, "Not found", {});
      res.end();
      return;
    }
    let pathPattern = methodMap._path;
    let method = req.method.toLowerCase();
    if (!(method in methodMap)) {
      res.writeHead(405, "Method not allowed", {});
      res.end();
      return;
    }
    react {
      const facet = Dataspace.currentFacet();
      let id = nextId++;
      assert Request(id, server, method, pieces, url.query, Seal(req));
      stop on retracted Observe(Request(_, server, method, pathPattern, _, _)) {
        // Error resulting in teardown of the route
        res.writeHead(500, "Internal server error", {});
        res.end();
      }
      stop on retracted Observe(Request(id, server, method, pieces, _, _)) {
        // Error specific to this particular request
        res.writeHead(500, "Internal server error", {});
        res.end();
      }
      on asserted Response(id, $code, $message, $headers, $detail)
      {
        res.writeHead(code, message, headers.toJS());
        if (detail === null) {
          react {
            on retracted Response(id, code, message, headers, detail) {
              res.end();
              facet.stop();
            }
            on message ResponseData(id, $chunk) {
              res.write(chunk);
            }
          }
        } else {
          res.end(detail);
          facet.stop();
        }
      }
    }
  }));

  function checkWSConnection(info, callback) {
    let url = parseUrl(info.req.url, true);
    let pieces = reqUrlPieces(url);
    let handlerCount = mapLookup(wsHandlerMap, pieces);
    if (!handlerCount) {
      callback(false, 404, "Not found", {});
    } else {
      callback(true);
    }
  }

  wss.on('connection', (ws, req) => {
    let url = parseUrl(info.req.url, true);
    let pieces = reqUrlPieces(url);
    // react {
    //   let id = nextId++;
    //   assert WebSocket(id, server, pieces, url.query);

    //   stop on retracted Observe(Request(_, server, method, pathPattern, _, _)) {
    //     res.writeHead(500, "Internal server error", {});
    //     res.end();
    //   }
    //   stop on asserted Response(
    //     id, $code, $message, $headers, $detail)
    //   {
    //     res.writeHead(code, message, headers.toJS());
    //     if (detail === null) {
    //       react {
    //         stop on retracted Response(id, code, message, headers, detail) {
    //           res.end();
    //         }
    //         on message ResponseData(id, $chunk) {
    //           res.write(chunk);
    //         }
    //       }
    //     } else {
    //       res.end(detail);
    //     }
    //   }
    // }
  });

  on start s.listen(port, host);
  on stop s.close();
}
