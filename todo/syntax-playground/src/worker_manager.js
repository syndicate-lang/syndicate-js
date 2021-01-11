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

const { Observe, spawnWorker } = activate require("@syndicate-lang/core");

assertion type Tick(who, n);
assertion type Tock(msg);
assertion type Tack(who);

assertion type Employee(id);

spawnWorker(__dirname + '/worker_employee.js', Employee(1));
spawnWorker(__dirname + '/worker_employee.js', Employee(2));

spawn {
  on message Tick($who, $n) {
    console.log('manager saw', who, 'tick', n);
    send Tock(who + ' ticked ' + n);
  }
  on asserted  Observe(Tock(_)) console.log('Someone is watching for Tock!');
  on retracted Observe(Tock(_)) console.log('No-one is watching for Tock!');
  on asserted  Tack($who) console.log('manager + tack:', who);
  on retracted Tack($who) console.log('manager - tack:', who);
}
