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

const { Observe, currentFacet, genUuid } = require("@syndicate-lang/core");
const { sleep } = activate require("@syndicate-lang/driver-timer");
const S = activate require("@syndicate-lang/driver-streams-node");

const stdin = genUuid('stdin');
const stdout = genUuid('stdout');
spawn named 'stdioServer' {
  during Observe(S.Readable(stdin)) spawn S.readableStreamBehaviour(stdin, process.stdin);
  during Observe(S.Writable(stdout)) spawn S.writableStreamBehaviour(stdout, process.stdout);
}

spawn named 'chatclient-via-nc' {
  const id = genUuid('p');
  assert S.Subprocess(id, 'nc', ['localhost', '5999'], {stdio: ['pipe', 'pipe', 'ignore']});
  stop on message S.SubprocessError(id, $err) {
    console.error("Couldn't start subprocess", err);
  }
  stop on retracted S.Readable(stdin);
  stop on retracted S.Writable(stdout);
  on asserted S.SubprocessRunning(id, _, [$i, $o, _]) {
    react {
      on message S.Line(stdin, $line) {
        console.log('INPUT:', line);
        send S.Push(i, line.toString('utf-8') + '\n', null);
      }
      on message S.End(stdin) {
        console.log('INPUT EOF');
        send S.Close(i, null);
      }

      on message S.Line(o, $line) send S.Push(stdout, line.toString('utf-8') + '\n', null);
    }
  }
  stop on asserted S.SubprocessExit(id, $code, $signal) {
    if (code !== 0) {
      console.error('Subprocess exited with code', code, 'signal', signal);
    }
  }
}
