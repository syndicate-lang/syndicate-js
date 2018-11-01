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

const Protocol = require("./protocol.js");

const N = 10;

console.time('box-and-client-' + N.toString());

ground dataspace G {
  spawn named 'box' {
    field this.value = 0;
    assert Protocol.BoxState(this.value);
    stop on (this.value === N);
    on message Protocol.SetBox($newValue) {
      this.value = newValue;
      console.log('box updated value', newValue);
    }
  }

  spawn named 'client' {
    on asserted Protocol.BoxState($v) {
      console.log('client sending SetBox', v + 1);
      << Protocol.SetBox(v + 1);
    }
  }
}

G.stopHandler = () => {
  console.timeEnd('box-and-client-' + N.toString());
};
