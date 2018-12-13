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

const { Inbound, Outbound } = require("@syndicate-lang/core");
const { PeriodicTick } = activate require("@syndicate-lang/driver-timer");

assertion type Tick(who, n);
assertion type Tock(msg);
assertion type Tack(who);

spawn named 'workerMain' {
  const myData = require('worker_threads').workerData;
  const limit = myData.get(0) === 1 ? 2 : 3;

  const me = myData.toString();

  console.log('In worker', me);

  field this.count = 0;

  stop on (this.count == limit) {
    console.log(me, 'stopped!');
  }

  assert Outbound(Tack(me + ' ' + this.count));

  on message PeriodicTick(1000) {
    console.log('tick', me, this.count);
    send Outbound(Tick(me, this.count++));
  }

  on message Inbound(Tock($msg)) {
    console.log(me, 'saw:', msg);
  }

  on asserted  Inbound(Tack($who)) console.log(me, '+++ tack:', who);
  on retracted Inbound(Tack($who)) console.log(me, '--- tack:', who);
}
