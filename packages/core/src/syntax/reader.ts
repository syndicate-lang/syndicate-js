import { TokenType, Token, Group, Item, Items } from './tokens.js';
import { Scanner } from './scanner.js';

function matchingParen(c: string): string | null {
    switch (c) {
        case ')': return '(';
        case ']': return '[';
        case '}': return '{';
        default: return null;
    }
}

export class LaxReader implements IterableIterator<Item> {
    readonly scanner: Scanner;
    readonly stack: Array<Group> = [];

    constructor(scanner: Scanner) {
        this.scanner = scanner;
    }

    [Symbol.iterator](): IterableIterator<Item> {
        return this;
    }

    stackTop(): Group | null {
        return this.stack[this.stack.length - 1] ?? null;
    }

    popUntilMatch(t: Token): Group | 'continue' | 'eof' {
        const m = matchingParen(t.text);

        if (m !== null && !this.stack.some(g => g.start.text === m)) {
            if (this.stack.length > 0) {
                this.stackTop().items.push(t);
                return 'continue';
            }
        } else {
            while (this.stack.length > 0) {
                const inner = this.stack.pop();
                if (inner.start.text === m) {
                    inner.end = t;
                }

                if (this.stack.length === 0) {
                    return inner;
                } else {
                    const outer = this.stackTop();
                    outer.items.push(inner);
                    if (inner.start.text === m) {
                        return 'continue';
                    }
                }
            }
        }

        return 'eof';
    }

    shift(): Token {
        return this.scanner.shift() ?? this.scanner.makeToken(this.scanner.mark(), TokenType.CLOSE, '');
    }

    read(): Item | null {
        while (true) {
            let g = this.stackTop();
            const t = this.shift();
            switch (t.type) {
                case TokenType.SPACE:
                case TokenType.NEWLINE:
                case TokenType.ATOM:
                case TokenType.STRING:
                    if (g === null) return t;
                    if (t.text === ';') {
                        while ('(['.indexOf(g.start.text) >= 0) {
                            this.stack.pop();
                            this.stackTop().items.push(g);
                            g = this.stackTop();
                        }
                    }
                    g.items.push(t);
                    break;

                case TokenType.OPEN:
                    this.stack.push({ start: t, end: null, items: [] });
                    break;

                case TokenType.CLOSE: {
                    const i = this.popUntilMatch(t);
                    if (i === 'eof') return null;
                    if (i === 'continue') break;
                    return i;
                }
            }
        }
    }

    readToEnd(): Items {
        return Array.from(this);
    }

    next(): IteratorResult<Item> {
        const i = this.read();
        if (i === null) {
            return { done: true, value: null };
        } else {
            return { done: false, value: i };
        }
    }
}
