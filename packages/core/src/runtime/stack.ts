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

export type NonEmptyStack<T> = { item: T, rest: Stack<T> };
export type Stack<T> = null | NonEmptyStack<T>;

export function empty<T>(): Stack<T> {
    return null;
}

export function push<T>(item: T, rest: Stack<T>): NonEmptyStack<T> {
    return { item, rest };
}

export function nonEmpty<T>(s: Stack<T>): s is NonEmptyStack<T> {
    return s !== empty();
}

export function rest<T>(s: Stack<T>): Stack<T> {
    if (nonEmpty(s)) {
        return s.rest;
    } else {
        throw new Error("pop from empty Stack");
    }
}

export function drop<T>(s: Stack<T>, n: number): Stack<T> {
    while (n--) s = rest(s);
    return s;
}

export function dropNonEmpty<T>(s: NonEmptyStack<T>, n: number): NonEmptyStack<T> {
    while (n--) {
        s = s.rest;
        if (!nonEmpty(s)) throw new Error("dropNonEmpty popped too far");
    }
    return s;
}
