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

import { Observe, Dataspace, genUuid, currentFacet } from "@syndicate-lang/core";
const S = activate require("@syndicate-lang/driver-streams-node");
const net = require('net');

const stdin = genUuid('stdin');
const stdout = genUuid('stdout');
spawn named 'stdioServer' {
  during Observe(S.Readable(stdin)) spawn S.readableStreamBehaviour(stdin, process.stdin);
  during Observe(S.Writable(stdout)) spawn S.writableStreamBehaviour(stdout, process.stdout);
}

spawn named 'chatclient' {
  const id = genUuid('tcpconn');
  assert S.OutgoingConnection(id, S.TcpAddress('localhost', 5999));
  stop on message S.ConnectionRejected(id, $err) {
    console.error('Connection rejected', err);
  }
  stop on message S.ConnectionAccepted(id) {
    react {
      stop on retracted S.Duplex(id);
      stop on retracted S.Readable(stdin);
      stop on retracted S.Writable(stdout);

      assert S.BackPressure(stdin, id);
      assert S.BackPressure(id, stdout);

      on message S.Line(stdin, $line) send S.Push(id, line.toString('utf-8') + '\n', null);
      on message S.Line(id, $line) send S.Push(stdout, line.toString('utf-8') + '\n', null);
    }
  }
}
