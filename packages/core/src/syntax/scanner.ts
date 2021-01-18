import { TokenType, Token } from './tokens.js';
import { Pos, advancePos } from './position.js';

export abstract class Scanner implements IterableIterator<Token> {
    readonly pos: Pos;
    charBuffer: string | null = null;
    tokenBuffer: Token | null = null;
    delimiters = ' \t\n\r\'"`.,;()[]{}/';

    constructor(pos: Pos) {
        this.pos = { ... pos };
    }

    [Symbol.iterator](): IterableIterator<Token> {
        return this;
    }

    abstract _peekChar(): string | null;

    peekChar(): string | null {
        if (this.charBuffer !== null) return this.charBuffer;
        this.charBuffer = this._peekChar();
        return this.charBuffer;
    }

    dropChar() {
        if (this.charBuffer === null) this.peekChar();
        if (this.charBuffer !== null) {
            advancePos(this.pos, this.charBuffer);
            this.charBuffer = null;
        }
    }

    shiftChar(): string | null {
        const ch = this.peekChar();
        this.dropChar();
        return ch;
    }

    makeToken(start: Pos, type: TokenType, text: string): Token {
        return { type, start, end: this.mark(), text };
    }

    mark(): Pos {
        return { ... this.pos };
    }

    _while(pred: (ch: string | null) => boolean, f: (ch: string | null) => void) {
        while (true) {
            const ch = this.peekChar();
            if (!pred(ch)) return;
            this.dropChar();
            f(ch);
        }
    }

    _collectSpace(buf = '', start = this.mark()): Token {
        this._while(ch => ch !== null && this.isSpace(ch), ch => buf = buf + ch);
        return this.makeToken(start, TokenType.SPACE, buf);
    }

    _punct(type: TokenType): Token {
        return this.makeToken(this.mark(), type, this.shiftChar()!);
    }

    _str(forbidNewlines: boolean): Token {
        const start = this.mark();
        const q = this.shiftChar()!;
        let buf = q;
        let ch: string | null;
        while (true) {
            ch = this.shiftChar();
            if (ch !== null) buf = buf + ch;
            if (ch === null || ch === q || (forbidNewlines && (ch === '\n'))) {
                return this.makeToken(start, TokenType.STRING, buf);
            }
            if (ch === '\\') {
                ch = this.shiftChar();
                if (ch === '\n') {
                    // Do nothing. Line continuation.
                } else if (ch !== null) {
                    buf = buf + ch;
                }
            }
        }
    }

    isSpace(ch: string): boolean {
        return ' \t\r'.indexOf(ch) >= 0;
    }

    isDelimiter(ch: string): boolean {
        return this.delimiters.indexOf(ch) >= 0;
    }

    addDelimiters(newDelimiters: string) {
        this.delimiters = this.delimiters + newDelimiters;
    }

    _atom(start = this.mark(), buf = ''): Token {
        let ch: string | null;
        while (true) {
            ch = this.peekChar();
            if (ch === null || this.isDelimiter(ch)) {
                return this.makeToken(start, TokenType.ATOM, buf);
            }
            buf = buf + ch;
            this.dropChar();
        }
    }

    _maybeComment(): Token {
        const start = this.mark();
        let buf = this.shiftChar()!;
        let ch = this.peekChar();
        if (ch === null) return this._collectSpace(buf, start);
        switch (ch) {
            case '/': // single-line comment.
                this._while(ch => ch !== null && ch !== '\n', ch => buf = buf + ch);
                return this._collectSpace(buf, start);
            case '*': // delimited comment.
                {
                    let seenStar = false;
                    buf = buf + this.shiftChar();
                    while (true) {
                        ch = this.shiftChar();
                        if ((ch === null) ||((ch === '/') && seenStar)) break;
                        buf = buf + ch;
                        seenStar = (ch === '*');
                    }
                    return this._collectSpace(buf, start);
                }
            default:
                return this._atom(start, buf);
        }
    }

    _peek(): Token | null {
        let ch = this.peekChar();
        if (ch === null) return null;
        switch (ch) {
            case ' ':
            case '\t':
            case '\r':
                return this._collectSpace();

            case '\n':
                return this._punct(TokenType.NEWLINE);

            case '(':
            case '[':
            case '{':
                return this._punct(TokenType.OPEN);
            case ')':
            case ']':
            case '}':
                return this._punct(TokenType.CLOSE);

            case '\'':
            case '"':
                return this._str(true);
            case '`':
                return this._str(false);

            case '.':
            case ',':
            case ';':
                return this._punct(TokenType.ATOM);

            case '/':
                return this._maybeComment();

            default:
                return this._atom(this.mark(), this.shiftChar()!);
        }
    }

    peek(): Token | null {
        if (this.tokenBuffer === null) this.tokenBuffer = this._peek();
        return this.tokenBuffer;
    }

    drop() {
        if (this.tokenBuffer === null) this.peek();
        this.tokenBuffer = null;
    }

    shift(): Token | null {
        const t = this.peek();
        this.drop();
        return t;
    }

    next(): IteratorResult<Token> {
        const t = this.shift();
        if (t === null) {
            return { done: true, value: null };
        } else {
            return { done: false, value: t };
        }
    }
}

export class StringScanner extends Scanner {
    readonly input: string;
    readonly startPos: number;

    constructor(pos: Pos, input: string) {
        super(pos);
        this.input = input;
        this.startPos = this.pos.pos;
    }

    _peekChar(): string | null {
        return this.input[this.pos.pos - this.startPos] ?? null;
    }
}
