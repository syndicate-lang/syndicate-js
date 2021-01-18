import { Token, TokenType, Items, Item, isGroup, isToken, isSpace, isTokenType } from './tokens.js';
import { Pos } from './position.js';
import { List, ArrayList, atEnd, notAtEnd } from './list.js';

//---------------------------------------------------------------------------
// Patterns over Item

export type PatternResult<T> = [T, List<Item>] | null;
export type Pattern<T> = (i: List<Item>) => PatternResult<T>;

export function match<T,F>(p: Pattern<T>, items: Items, failure: F): T | F {
    const r = p(new ArrayList(items));
    if (r === null) return failure;
    if (notAtEnd(r[1])) return failure;
    return r[0];
}

export const noItems = new ArrayList<Item>([]);

export const fail: Pattern<never> = _i => null;
export function succeed<T>(t: T): Pattern<T> { return i => [t, i]; }

export const discard: Pattern<void> = _i => [void 0, noItems];
export const rest: Pattern<Items> = i => [i.toArray(), noItems];
export const end: Pattern<void> = i => atEnd(skipSpace(i)) ? [void 0, noItems] : null;
export const pos: Pattern<Pos> = i =>
    notAtEnd(i)
    ? [isGroup(i.item) ? i.item.start.start : i.item.start, i]
    : null;

export const newline: Pattern<Item> = i => {
    while (notAtEnd(i) && isTokenType(i.item, TokenType.SPACE)) i = i.next;
    if (!notAtEnd(i) || !isTokenType(i.item, TokenType.NEWLINE)) return null;
    return [i.item, i.next];
};

export function skipSpace(i: List<Item>): List<Item> {
    while (notAtEnd(i) && isSpace(i.item)) i = i.next;
    return i;
}

export function collectSpace(i: List<Item>, acc: Array<Item>): List<Item> {
    while (notAtEnd(i) && isSpace(i.item)) {
        acc.push(i.item);
        i = i.next;
    }
    return i;
}

export function withoutSpace<T>(p: Pattern<T>): Pattern<T> {
    return i => p(skipSpace(i));
}

export function seq(... patterns: Pattern<any>[]): Pattern<void> {
    return i => {
        for (const p of patterns) {
            const r = p(i);
            if (r === null) return null;
            i = r[1];
        }
        return [void 0, i];
    };
}

export function alt<T>(... alts: Pattern<T>[]): Pattern<T> {
    return i => {
        for (const a of alts) {
            const r = a(i);
            if (r !== null) return r;
        }
        return null;
    };
}

export function scope<T>(pf: (scope: T) => Pattern<any>): Pattern<T> {
    return i => {
        const scope = Object.create(null);
        const r = pf(scope)(i);
        if (r === null) return null;
        return [scope, r[1]];
    };
}

export function value<T>(pf: (scope: {value: T}) => Pattern<any>): Pattern<T> {
    return i => {
        const scope = Object.create(null);
        const r = pf(scope)(i);
        if (r === null) return null;
        return [scope.value, r[1]];
    };
}

export function bind<T, K extends keyof T>(target: T, key: K, pattern: Pattern<T[K]>): Pattern<T[K]> {
    return i => {
        const r = pattern(i);
        if (r === null) return null;
        target[key] = r[0];
        return r;
    };
}

export function exec(thunk: (i: List<Item>) => void): Pattern<void> {
    return i => {
        thunk(i);
        return [void 0, i];
    };
}

export function map<T, R>(p: Pattern<T>, f: (t: T) => R): Pattern<R> {
    return i => {
        const r = p(i);
        if (r === null) return null;
        return [f(r[0]), r[1]];
    };
}

export function mapm<T, R>(p: Pattern<T>, f: (t: T) => Pattern<R>): Pattern<R> {
    return i => {
        const r = p(i);
        if (r === null) return null;
        return f(r[0])(r[1]);
    };
}

export interface ItemOptions {
    skipSpace?: boolean, // default: true
    advance?: boolean, // default: true
}

export interface GroupOptions extends ItemOptions {
}

export interface TokenOptions extends ItemOptions {
    tokenType?: TokenType, // default: TokenType.ATOM
}

export function group<T>(opener: string, items: Pattern<T>, options: GroupOptions = {}): Pattern<T> {
    return i => {
        if (options.skipSpace ?? true) i = skipSpace(i);
        if (!notAtEnd(i)) return null;
        if (!isGroup(i.item)) return null;
        if (i.item.start.text !== opener) return null;
        const r = items(new ArrayList(i.item.items));
        if (r === null) return null;
        if (!atEnd(r[1])) return null;
        return [r[0], (options.advance ?? true) ? i.next : i];
    };
}

export function atomString<T extends string>(text: T, options: TokenOptions = {}): Pattern<T> {
    return map(atom(text, options), _t => text);
}

export function atom(text?: string, options: TokenOptions = {}): Pattern<Token> {
    return i => {
        if (options.skipSpace ?? true) i = skipSpace(i);
        if (!notAtEnd(i)) return null;
        if (!isToken(i.item)) return null;
        if (i.item.type !== (options.tokenType ?? TokenType.ATOM)) return null;
        if (text !== void 0 && i.item.text !== text) return null;
        return [i.item, (options.advance ?? true) ? i.next : i];
    }
}

export function anything(options: ItemOptions = {}): Pattern<Item> {
    return i => {
        if (options.skipSpace ?? true) i = skipSpace(i);
        if (!notAtEnd(i)) return null;
        return [i.item, (options.advance ?? true) ? i.next : i];
    };
}

export function upTo(p: Pattern<any>): Pattern<Items> {
    return i => {
        const acc = [];
        while (true) {
            const r = p(i);
            if (r !== null) return [acc, i];
            if (!notAtEnd(i)) break;
            acc.push(i.item);
            i = i.next;
        }
        return null;
    };
}

export function separatedBy<T>(itemPattern: Pattern<T>, separator: Pattern<any>): Pattern<T[]> {
    return i => {
        const acc: T[] = [];
        if (end(i) !== null) return [acc, noItems];
        while (true) {
            {
                const r = itemPattern(i);
                if (r === null) return null;
                acc.push(r[0]);
                i = r[1];
            }
            {
                const r = separator(i);
                if (r === null) {
                    if (end(i) !== null) return [acc, noItems];
                    return null;
                }
                i = r[1];
            }
        }
    };
}

export interface RepeatOptions {
    min?: number;
    max?: number;
    separator?: Pattern<any>;
}

export function repeat<T>(p: Pattern<T>, options: RepeatOptions = {}): Pattern<T[]> {
    return i => {
        const acc: T[] = [];
        let needSeparator = false;
        const finish = (): PatternResult<T[]> => (acc.length < (options.min ?? 0)) ? null : [acc, i];
        while (true) {
            if (acc.length == (options.max ?? Infinity)) return [acc, i];
            if (needSeparator) {
                if (options.separator) {
                    const r = options.separator(i);
                    if (r === null) return finish();
                    i = r[1];
                }
            } else {
                needSeparator = true;
            }
            const r = p(i);
            if (r === null) return finish();
            acc.push(r[0]);
            i = r[1];
        }
    };
}

export function option<T>(p: Pattern<T>): Pattern<T[]> {
    return repeat(p, { max: 1 });
}

//---------------------------------------------------------------------------
// Search-and-replace over Item

export function replace<T>(items: Items,
                           p: Pattern<T>,
                           f: (t: T) => Items): Items
{
    const walkItems = (items: Items): Items => {
        let i: List<Item> = new ArrayList(items);
        const acc: Items = [];
        while (notAtEnd(i = collectSpace(i, acc))) {
            const r = p(i);

            if (r !== null) {
                acc.push(... f(r[0]));
                i = r[1];
            } else if (isToken(i.item)) {
                acc.push(i.item);
                i = i.next;
            } else {
                acc.push({ ... i.item, items: walkItems(i.item.items) });
                i = i.next;
            }
        }
        return acc;
    };
    return walkItems(items);
}
