import { Pos, startPos } from './position.js';

export enum TokenType {
    SPACE,
    NEWLINE,
    ATOM,
    STRING,
    OPEN,
    CLOSE,
}

export interface Token {
    type: TokenType;
    start: Pos;
    end: Pos;
    text: string;
}

export interface Group {
    start: Token;
    end: Token | null;
    items: Items;
}

export type Item = Token | Group;
export type Items = Array<Item>;

export function makeToken(text: string, name?: string | null, type: TokenType = TokenType.ATOM): Token {
    const p = startPos(name ?? null);
    return {
        start: p,
        end: p,
        type,
        text
    };
}

export function makeGroup(start: Token, items: Array<Items>, end?: Token) {
    return { start, end: end ?? null, items };
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

export function itemText(i: Items, options: ItemTextOptions = {}): string {
    const walkItems = (i: Items): string => i.map(walk).join('');
    const walk = (i: Item): string => {
        if (isGroup(i)) {
            return walk(i.start) + walkItems(i.items) + (i.end ? walk(i.end) : options.missing ?? '');
        } else {
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
        }
    };
    return walkItems(i);
}
