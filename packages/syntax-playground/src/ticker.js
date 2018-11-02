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

import { Dataspace } from "@syndicate-lang/core";

const Timer = activate require("@syndicate-lang/driver-timer");
const TimeLaterThan = Timer.TimeLaterThan;

spawn named 'ticker' {
  field this.counter = 0;
  field this.deadline = +(new Date());

  on start { console.log('ticker starting'); }
  on stop  { console.log('ticker stopping'); }

  on asserted TimeLaterThan(this.deadline) {
    this.counter++;
    console.log('tick', new Date(), this.counter);
    this.deadline += 1000;
  }

  stop on (this.counter == 5);
}

