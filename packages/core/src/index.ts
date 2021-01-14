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

export * from 'preserves';

export * from './runtime/randomid.js';
export * from './runtime/assertions.js';
export * from './runtime/bag.js';
export * as Skeleton from './runtime/skeleton.js';
export * from './runtime/dataspace.js';
export * from './runtime/ground.js';
export * from './runtime/relay.js';
// export * as Worker from './runtime/worker.js';

export * as Syntax from './syntax/index.js';
export * as Compiler from './compiler/index.js';

import { randomId } from './runtime/randomid.js';

// These aren't so much "Universal" as they are "VM-wide-unique".
let uuidIndex = 0;
let uuidInstance = randomId(8);
export function genUuid(prefix: string = '__@syndicate'): string {
    return `${prefix}_${uuidInstance}_${uuidIndex++}`;
}
