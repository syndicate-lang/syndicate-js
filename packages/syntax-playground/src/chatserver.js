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

const { genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

message type Speak(who, what);
assertion type Present(who);

spawn named 'chatserver' {
  on asserted S.IncomingConnection($id, S.TcpListener(5999)) {
    const me = genUuid('user');
    spawn named ['connectedUser', me] {
      stop on retracted S.Duplex(id);

      assert Present(me);
      on asserted  Present($who) send S.Push(id, `${who} arrived.\n`, null);
      on retracted Present($who) send S.Push(id, `${who} departed.\n`, null);

      on message S.Line(id, $line) send Speak(me, line);
      on message Speak($who, $what) send S.Push(id, `${who}: ${what}\n`, null);
    }
  }
}
