import { Items } from './tokens.js';
import { Pos, startPos } from './position.js';
import { laxRead } from './reader.js';
import * as M from './matcher.js';

const substPat = M.scope((o: { pos: Pos }) =>
    M.seq(M.atom('$'),
          M.seq(M.bind(o, 'pos', M.pos), M.group('{', M.end, { skipSpace: false }))));

export type Substitution = Items | string;

function toItems(s: Substitution, pos: Pos): Items {
    return typeof s === 'string' ? laxRead(s) : s;
}

export class Templates {
    readonly sources: { [name: string]: string } = {};

    template(start0: Pos | string = startPos(null)): (consts: TemplateStringsArray, ... vars: Substitution[]) => Items {
        const start = (typeof start0 === 'string') ? startPos(start0) : start0;
        return (consts, ... vars) => {
            const sourcePieces = [consts[0]];
            for (let i = 1; i < consts.length; i++) {
                sourcePieces.push('${}');
                sourcePieces.push(consts[i]);
            }
            const source = sourcePieces.join('');
            if (start.name !== null) {
                if (start.name in this.sources && this.sources[start.name] !== source) {
                    throw new Error(`Duplicate template name: ${start.name}`);
                }
                this.sources[start.name] = source;
            }
            let i = 0;
            return M.replace(laxRead(source, { start, extraDelimiters: '$' }),
                             substPat,
                             sub => toItems(vars[i++], sub.pos));
        };
    }

    sourceFor(name: string): string | undefined {
        return this.sources[name];
    }
}

export function joinItems(itemss: Items[], separator0: Substitution): Items {
    if (itemss.length === 0) return [];
    const separator = toItems(separator0, startPos(null));
    const acc = itemss[0];
    for (let i = 1; i < itemss.length; i++) {
        acc.push(... separator, ... itemss[i]);
    }
    return acc;
}

export function commaJoin(itemss: Items[]): Items {
    return joinItems(itemss, ', ');
}

export const anonymousTemplate = (new Templates()).template();

// const lib = new Templates();
// const t = (o: {xs: Items}) => lib.template('testTemplate')`YOYOYOYO ${o.xs}><`;
// console.log(t({xs: lib.template()`hello there`}));
