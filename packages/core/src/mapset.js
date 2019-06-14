"use strict";
//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
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

// Utilities for Maps of Sets

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                require('path').basename(module.filename),
                                                module)) return;

var Immutable = require('immutable');

function add(ms, key, val) {
  return ms.set(key, (ms.get(key) || Immutable.Set()).add(val));
}

function remove(ms, key, val) {
  var oldSet = ms.get(key);
  if (oldSet) {
    var newSet = oldSet.remove(val);
    if (newSet.isEmpty()) {
      ms = ms.remove(key);
    } else {
      ms = ms.set(key, newSet);
    }
  }
  return ms;
}

///////////////////////////////////////////////////////////////////////////

module.exports.add = add;
module.exports.remove = remove;
