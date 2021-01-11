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

import { Dataspace, Outbound, Inbound } from '@syndicate-lang/core';
import { $QuitDataspace } from '@syndicate-lang/core';

assertion type Greeting(text);

spawn named 'A' assert Greeting('Hi from outer space!');
spawn named 'B' on asserted Greeting($t) console.log('Outer dataspace:', t);

spawn on retracted Greeting($t) console.log('Vanished:', t);

spawn dataspace named 'C' {
  spawn named 'D' assert Outbound(Greeting('Hi from middle!'));
  spawn named 'E' on asserted Inbound(Greeting($t)) console.log('Middle dataspace:', t);

  spawn dataspace named 'F' {
    spawn named 'G' {
      assert Outbound(Outbound(Greeting('Inner!')));
      on start {
        Dataspace.currentFacet().actor.adhocAssert(Outbound(Outbound(Greeting('Adhoc'))));
      }
    }
    spawn named 'H' on asserted Inbound(Inbound(Greeting($t))) console.log('Inner dataspace:', t);
    spawn named 'I' on asserted Inbound(Inbound(Greeting('Inner!'))) {
      console.log('I: Terminating F');
      send $QuitDataspace;
    };
  }

  spawn named 'J' :asserting Outbound(Greeting('Hello from J')) {
    on start throw new Error('Deliberate exception');
  }
}
