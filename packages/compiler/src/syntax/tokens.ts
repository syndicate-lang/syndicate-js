import { Pos } from './position.js';

export enum TokenType {
    SPACE,
    NEWLINE,
    ATOM,
    STRING,
    OPEN,
    CLOSE,
}

export interface TokenBase {
    start: Pos;
    end: Pos;
    synthetic?: boolean; // default: false
}

export interface Token extends TokenBase {
    type: TokenType;
    text: string;
}

export interface Group extends TokenBase {
    open: Token;
    close: Token | null;
    items: Items;
}

export type Item = Token | Group;
export type Items = Array<Item>;

export type GroupInProgress = Omit<Group, 'end'>;

export function finishGroup(g: GroupInProgress, end: Pos): Group {
    return { ... g, end };
}

export function makeGroup(open: Token, items: Array<Item>, close: Token): Group {
    return { start: open.start, open, end: close.end, close, items };
}

export function isSpace(i: Item): i is Token {
    return isTokenType(i, TokenType.SPACE) || isTokenType(i, TokenType.NEWLINE);
}

export function isGroup(i: Item): i is Group {
    return i && ('items' in i);
}

export function isToken(i: Item): i is Token {
    return i && ('type' in i);
}

export function isTokenType(i: Item, t: TokenType): i is Token {
    return isToken(i) && i.type === t;
}

export type ItemTextOptions = {
    missing?: string,
    color?: boolean,
};

export function foldItems<T>(i: Items,
                             fToken: (t: Token) => T,
                             fGroup: (g: Group, t: T, k: (t: Token) => T) => T,
                             fItems: (ts: T[]) => T): T
{
    const walk = (i: Item): T => {
        if (isGroup(i)) {
            return fGroup(i, fItems(i.items.map(walk)), walk);
        } else {
            return fToken(i);
        }
    };
    return fItems(i.map(walk));
}

export function itemText(items: Items, options: ItemTextOptions = {}): string {
    return foldItems(
        items,
        i => {
            if (options.color ?? false) {
                switch (i.type) {
                    case TokenType.SPACE:
                    case TokenType.NEWLINE:
                        return '\x1b[31m' + i.text + '\x1b[0m';
                    case TokenType.STRING:
                        return '\x1b[34m' + i.text + '\x1b[0m';
                    default:
                        return i.text;
                }
            } else {
                return i.text;
            }
        },
        (g, inner, k) => k(g.open) + inner + (g.close ? k(g.close) : options.missing ?? ''),
        strs => strs.join(''));
}
