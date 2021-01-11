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

// Bags and Deltas (which are Bags where item-counts can be negative).

import { Value, Set, Dictionary } from 'preserves';

export enum ChangeDescription {
    PRESENT_TO_ABSENT = -1,
    ABSENT_TO_ABSENT = 0,
    ABSENT_TO_PRESENT = 1,
    PRESENT_TO_PRESENT = 2,
}

export class Bag {
    _items: Dictionary<number>;

    constructor(s?: Set) {
        this._items = new Dictionary();
        if (s) s.forEach((v) => this._items.set(v, 1));
    }

    get(key: Value): number {
        return this._items.get(key, 0) as number;
    }

    change(key: Value, delta: number, clamp: boolean = false): ChangeDescription {
        let oldCount = this.get(key);
        let newCount = oldCount + delta;
        if (clamp) {
            newCount = Math.max(0, newCount);
        }

        if (newCount === 0) {
            this._items.delete(key);
            return (oldCount === 0)
                ? ChangeDescription.ABSENT_TO_ABSENT
                : ChangeDescription.PRESENT_TO_ABSENT;
        } else {
            this._items.set(key, newCount);
            return (oldCount === 0)
                ? ChangeDescription.ABSENT_TO_PRESENT
                : ChangeDescription.PRESENT_TO_PRESENT;
        }
    }

    clear() {
        this._items = new Dictionary();
    }

    includes(key: Value): boolean {
        return this._items.has(key);
    }

    get size(): number {
        return this._items.size;
    }

    keys(): IterableIterator<Value> {
        return this._items.keys();
    }

    entries(): IterableIterator<[Value, number]> {
        return this._items.entries();
    }

    forEach(f: (count: number, value: Value) => void) {
        this._items.forEach(f);
    }

    snapshot(): Dictionary<number> {
        return this._items.clone();
    }

    clone(): Bag {
        const b = new Bag();
        b._items = this._items.clone();
        return b;
    }
}
