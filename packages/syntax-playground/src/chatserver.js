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
const Tcp = activate require("@syndicate-lang/driver-tcp-node");

message type Speak(who, what);
assertion type Present(who);

spawn named 'chatserver' {
  during Tcp.TcpConnection($id, Tcp.TcpListener(5999)) spawn {
    assert Tcp.TcpAccepted(id);
    const me = genUuid('user');

    assert Present(me);
    during Present($who) {
      on start { ^ Tcp.TcpOut(id, `${who} arrived.\n`); }
      on stop  { ^ Tcp.TcpOut(id, `${who} departed.\n`); }
    }

    on message Tcp.TcpInLine(id, $line) { ^ Speak(me, line); }
    on message Speak($who, $what) { ^ Tcp.TcpOut(id, `${who}: ${what}\n`); }
  }
}
