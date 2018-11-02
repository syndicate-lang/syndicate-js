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

message type Tick();

spawn named 'ticker' {
  field this.counter = 0;

  on start { console.log('ticker starting'); }
  on stop  { console.log('ticker stopping'); }

  on message Tick() {
    this.counter++;
    console.log('tick', new Date(), this.counter);
    if (this.counter < 5) {
      Dataspace.backgroundTask((finish) => {
        setTimeout(Dataspace.wrapExternal(() => {
          << Tick();
          finish();
        }), 1000);
      });
    }
  }

  on start {
    console.log('sending first tick');
    << Tick();
  }
}
