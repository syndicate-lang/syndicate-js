#!/usr/bin/env -S node --es-module-specifier-resolution=node
//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
// Copyright (C) 2016-2021 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
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

assertion type BoxState(value);
message type SetBox(newValue);

const N = 100000;

console.time('box-and-client-' + N.toString());

boot {
  spawn named 'box' {
    field this.value = 0;
    assert BoxState(this.value);
    stop on (this.value === N) console.log('terminated box root facet');
    on message SetBox($v) => this.value = v;
  }

  spawn named 'client' {
    on asserted BoxState($v) => send SetBox(v + 1);
    on retracted BoxState(_) => console.log('box gone');
  }

  thisFacet.actor.dataspace.addStopHandler(() =>
    console.timeEnd('box-and-client-' + N.toString()));
}

new __SYNDICATE__.Ground(__SYNDICATE__bootProc).start();
