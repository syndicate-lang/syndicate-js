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

import { Record, RecordConstructor, AsPreserve } from 'preserves';

export class Seal {
    readonly contents: any;

    constructor(contents: any) {
        this.contents = contents;
    }

    [AsPreserve](): any { // should return Value; we are cheating
        return this;
    }
}

interface Discard extends RecordConstructor {
    _instance: Record;
}

export const Discard: Discard = (function () {
    let Discard: any = Record.makeConstructor('discard', []);
    Discard._instance = Discard();
    return Discard;
})();

export const Capture = Record.makeConstructor('capture', ['specification']);
export const Observe = Record.makeConstructor('observe', ['specification']);

export const Inbound = Record.makeConstructor('inbound', ['assertion']);
export const Outbound = Record.makeConstructor('outbound', ['assertion']);
export const Instance = Record.makeConstructor('instance', ['uniqueId']);
