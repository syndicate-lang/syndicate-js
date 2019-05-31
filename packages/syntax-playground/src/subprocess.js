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

const { currentFacet, genUuid } = require("@syndicate-lang/core");
const { sleep } = activate require("@syndicate-lang/driver-timer");
const S = activate require("@syndicate-lang/driver-streams-node");

spawn named 'lister' {
  const go = () => {
    react {

      const id = genUuid('p');
      assert S.Subprocess(id, 'nc', ['localhost', '80'], {stdio: ['pipe', 'pipe', 'ignore']});
      stop on message S.SubprocessError(id, $err) console.error("Couldn't start subprocess", err);

      on asserted S.SubprocessRunning(id, _, [$i, $o, _]) {
        send S.Stream(i, S.Push("GET / HTTP/1.0\r\n\r\n", null));
        send S.Stream(i, S.Close(null));
        react {
          on message S.Stream(o, S.Data($chunk)) console.log(chunk);
          on asserted S.Stream(o, S.End()) console.log('DONE!');
        }
      }

      stop on asserted S.SubprocessExit(id, $code, $signal) {
        console.log('No longer running', new Date(), code, signal);
        sleep(1000, go);
      }

    }
  };
  on start go();
}
