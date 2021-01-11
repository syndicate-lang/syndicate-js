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

// Utilities for Maps of Sets

import { FlexSet, FlexMap, Canonicalizer } from 'preserves';

export function add<K,V>(m: FlexMap<K, FlexSet<V>>, k: K, v: V, c: Canonicalizer<V>) {
    let s = m.get(k);
    if (!s) {
        s = new FlexSet(c);
        m.set(k, s);
    }
    s.add(v);
}

export function del<K,V>(m: FlexMap<K, FlexSet<V>>, k: K, v: V) {
    const s = m.get(k);
    if (!s) return;
    s.delete(v);
    if (s.size === 0) m.delete(k);
}
