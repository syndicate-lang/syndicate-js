import { TokenType, Token, Group, GroupInProgress, Item, Items, finishGroup } from './tokens.js';
import { Pos, startPos } from './position.js';
import { Scanner, StringScanner } from './scanner.js';

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
    readonly stack: Array<GroupInProgress> = [];

    constructor(scanner: Scanner) {
        this.scanner = scanner;
    }

    [Symbol.iterator](): IterableIterator<Item> {
        return this;
    }

    stackTop(): GroupInProgress | null {
        return this.stack[this.stack.length - 1] ?? null;
    }

    popUntilMatch(t: Token): Group | 'continue' | 'eof' {
        const m = matchingParen(t.text);

        if (m !== null && !this.stack.some(g => g.open.text === m)) {
            if (this.stack.length > 0) {
                this.stackTop()!.items.push(t);
                return 'continue';
            }
        } else {
            while (this.stack.length > 0) {
                const inner = finishGroup(this.stack.pop()!, t.end);
                if (inner.open.text === m) {
                    inner.close = t;
                }

                if (this.stack.length === 0) {
                    return inner;
                } else {
                    const outer = this.stackTop()!;
                    outer.items.push(inner);
                    if (inner.open.text === m) {
                        return 'continue';
                    }
                }
            }
        }

        return 'eof';
    }

    peek(): Token {
        return this.scanner.peek() ?? this.scanner.makeToken(this.scanner.mark(), TokenType.CLOSE, '');
    }

    drop() {
        this.scanner.drop();
    }

    read(): Item | null {
        while (true) {
            let g = this.stackTop();
            const t = this.peek();
            switch (t.type) {
                case TokenType.SPACE:
                case TokenType.NEWLINE:
                case TokenType.ATOM:
                case TokenType.STRING:
                    if (g === null) {
                        this.drop();
                        return t;
                    }
                    if (t.text === ';') {
                        while ('(['.indexOf(g.open.text) >= 0) {
                            this.stack.pop();
                            const outer = this.stackTop();
                            if (outer === null) {
                                // do not drop the semicolon here
                                return finishGroup(g, t.start);
                            }
                            outer.items.push(finishGroup(g, t.start));
                            g = outer;
                        }
                    }
                    this.drop();
                    g.items.push(t);
                    break;

                case TokenType.OPEN:
                    this.drop();
                    this.stack.push(this.scanner.makeGroupInProgress(t));
                    break;

                case TokenType.CLOSE: {
                    this.drop();
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

export interface LaxReadOptions {
    start?: Pos,
    name?: string,
    extraDelimiters?: string,
}

export function laxRead(source: string, options: LaxReadOptions = {}): Items {
    const start = options.start ?? startPos(options.name ?? null);
    const scanner = new StringScanner(start, source);
    if (options.extraDelimiters) scanner.addDelimiters(options.extraDelimiters);
    const reader = new LaxReader(scanner);
    return reader.readToEnd();
}
