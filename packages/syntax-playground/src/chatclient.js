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
  during Observe(S.Stream(stdin, S.Readable()))
    spawn S.readableStreamBehaviour(stdin, process.stdin);
  during Observe(S.Stream(stdout, S.Writable()))
    spawn S.writableStreamBehaviour(stdout, process.stdout);
}

spawn named 'chatclient' {
  const id = genUuid('tcpconn');
  assert S.Stream(id, S.Outgoing(S.TcpAddress('localhost', 5999)));
  stop on message S.Stream(id, S.Rejected($err)) {
    console.error('Connection rejected', err);
  }
  stop on message S.Stream(id, S.Accepted()) {
    react {
      stop on retracted S.Stream(id, S.Duplex());
      stop on retracted S.Stream(stdin, S.Readable());
      stop on retracted S.Stream(stdout, S.Writable());

      assert S.Stream(stdin, S.BackPressure(id));
      assert S.Stream(id, S.BackPressure(stdout));

      on message S.Stream(stdin, S.Line($line)) {
        send S.Stream(id, S.Push(line.toString('utf-8') + '\n', false));
      }
      on message S.Stream(id, S.Line($line)) {
        send S.Stream(stdout, S.Push(line.toString('utf-8') + '\n', false));
      }
    }
  }
}
