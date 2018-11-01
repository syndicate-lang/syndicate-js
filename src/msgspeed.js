"use strict";
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

var Dataspace = require('@syndicate-lang/core').Dataspace;

const N = 100000;

console.time('msgspeed-' + N.toString());

ground dataspace G {
  spawn {
    on start {
      << 0;
    }
    on message $v {
      if (v === N) {
        Dataspace.currentFacet().stop(() => { });
      } else {
        << v + 1;
      }
    }
  }
}

G.stopHandler = () => {
  console.timeEnd('msgspeed-' + N.toString());
};
