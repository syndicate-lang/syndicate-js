//---------------------------------------------------------------------------
// @syndicate-lang/syntax-test, a demo of Syndicate extensions to JS.
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

import { Dataspace, genUuid, currentFacet } from "@syndicate-lang/core";
const Tcp = activate require("@syndicate-lang/driver-tcp-node");
const split = require('split');

spawn named 'chatclient' {
  const id = genUuid('tcpconn');
  const rootFacet = currentFacet();

  assert Tcp.TcpConnection(id, Tcp.TcpAddress('localhost', 5999));
  stop on asserted Tcp.TcpRejected(id, $err) {
    console.error('Connection rejected', err);
  }
  during Tcp.TcpAccepted(id) {
    on start process.stdin.pipe(split())
      .on('error', Dataspace.wrapExternal((err) => { throw err; }))
      .on('close', Dataspace.wrapExternal(() => { rootFacet.stop(); }))
      .on('data', Dataspace.wrapExternal(
        (data) => { if (data) send Tcp.DataOut(id, data + '\n'); }));
    on stop process.stdin.destroy();

    on message Tcp.LineIn(id, $line) { console.log(line.toString('utf-8')); }
  }
}
