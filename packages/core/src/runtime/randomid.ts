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

import { Bytes } from 'preserves';
import * as node_crypto from 'crypto';

export function _btoa(s: string): string {
    try {
        return btoa(s);
    } catch (e) {
        return Buffer.from(s).toString('base64');
    }
}

export function randomId(byteCount: number, hexOutput: boolean = false): string {
    let buf: Uint8Array;
    if (node_crypto.randomBytes !== void 0) {
        buf = node_crypto.randomBytes(byteCount);
    } else {
        buf = new Uint8Array(byteCount);
        crypto.getRandomValues(buf);
    }
    if (hexOutput) {
        return Bytes.from(buf).toHex();
    } else {
        return _btoa(String.fromCharCode.apply(null, buf as unknown as number[])).replace(/=/g,'');
    }
}
