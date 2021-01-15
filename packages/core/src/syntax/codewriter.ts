import { TokenType, Item, Items, isGroup } from './tokens.js';
import { Pos, startPos, advancePos } from './position.js';
import { vlqEncode } from './vlq.js';

export interface SourceMap {
    version: 3;
    file?: string;
    sourceRoot?: string, // default: ""
    sources: Array<string>;
    sourcesContent?: Array<string | null>; // default: null at each entry
    names: Array<string>;
    mappings: string;
}

export interface NoSourceMapping {
    generatedStartColumn: number; // zero-based
}
export interface SourceMapping extends NoSourceMapping {
    sourceIndex: number;
    sourceStartLine: number; // zero-based (!!)
    sourceStartColumn: number; // zero-based
}
export interface SourceNameMapping extends SourceMapping {
    nameIndex: number;
}

export type NonEmptyMapping = NoSourceMapping | SourceMapping | SourceNameMapping;
export type Mapping = {} | NonEmptyMapping;

function encodeMapping(entry: NonEmptyMapping): Array<number> {
    const a = [entry.generatedStartColumn];
    if ('sourceIndex' in entry) {
        a.push(entry.sourceIndex);
        a.push(entry.sourceStartLine);
        a.push(entry.sourceStartColumn);
        if ('nameIndex' in entry) {
            a.push(entry.nameIndex);
        }
    }
    return a;
}

function maybeDelta(newValue: number, oldValue: number | undefined): number {
    // console.log('maybeDelta', oldValue, newValue);
    return (oldValue === void 0) ? newValue : newValue - oldValue;
}

export class CodeWriter {
    readonly file: string | null;
    readonly pos: Pos;
    readonly sources: Array<string> = [];
    readonly chunks: Array<string> = [];
    readonly mappings: Array<Array<NonEmptyMapping>> = [];
    previous: Partial<SourceNameMapping> = {};
    previousPos: Pos | null = null;

    constructor(file: string | null) {
        this.file = file;
        this.pos = startPos(this.file ?? '');
    }

    get text(): string {
        return this.chunks.join('');
    }

    get map(): SourceMap {
        // console.log(this.mappings.map(segs => segs.map(encodeMapping)));
        const mappings = this.mappings.map(segments =>
            segments.map(encodeMapping).map(vlqEncode).join(',')).join(';');
        const m: SourceMap = {
            version: 3,
            sources: [... this.sources],
            names: [],
            mappings,
        };
        if (this.file !== null) m.file = this.file;
        return m;
    }

    finishLine() {
        // console.log('newline');
        this.mappings.push([]);
        this.previous.generatedStartColumn = undefined;
        this.previousPos = null;
    }

    sourceIndexFor(name: string) {
        let i = this.sources.indexOf(name);
        if (i === -1) {
            this.sources.push(name);
            i = this.sources.length - 1;
        }
        return i;
    }

    addMapping(p: Pos, type: TokenType) {
        // console.log('considering', p, type);

        const oldPos = this.previousPos;

        if ((oldPos === null || oldPos.name === p.name) &&
            (type === TokenType.SPACE || type === TokenType.NEWLINE))
        {
            // console.log('whitespace skip');
            if (this.previousPos !== null) {
                this.previousPos = p;
            }
            return;
        }

        this.previousPos = p;

        if ((oldPos?.name === p.name) &&
            ((p.name === null) ||
                ((oldPos?.column === p.column) && (oldPos?.line === p.line))))
        {
            // console.log('skipping', this.previous, oldPos, p);
            return;
        }

        let n: NonEmptyMapping = {
            generatedStartColumn: maybeDelta(this.pos.column, this.previous.generatedStartColumn),
        };
        this.previous.generatedStartColumn = this.pos.column;

        if (p.name !== null) {
            const sourceIndex = this.sourceIndexFor(p.name);
            n = {
                ... n,
                sourceIndex: maybeDelta(sourceIndex, this.previous.sourceIndex),
                sourceStartColumn: maybeDelta(p.column, this.previous.sourceStartColumn),
                sourceStartLine: maybeDelta(p.line - 1, this.previous.sourceStartLine),
            };
            this.previous.sourceIndex = sourceIndex;
            this.previous.sourceStartColumn = p.column;
            this.previous.sourceStartLine = p.line - 1;
        }

        // console.log('pushing',
        //             n,
        //             this.previous,
        //             oldPos?.line + ':' + oldPos?.column,
        //             p.line + ':' + p.column);
        this.mappings[this.mappings.length - 1].push(n);
    }

    chunk(p: Pos, s: string, type: TokenType) {
        p = { ... p };
        this.chunks.push(s);
        if (this.mappings.length === 0) this.finishLine();
        this.addMapping(p, type);
        for (const ch of s) {
            advancePos(p, ch);
            if (advancePos(this.pos, ch)) {
                this.finishLine();
                this.addMapping(p, type);
            }
        }
    }

    emit(i: Item | Items) {
        if (Array.isArray(i)) {
            i.forEach(j => this.emit(j));
        } else if (isGroup(i)) {
            this.emit(i.start);
            this.emit(i.items);
            if (i.end) this.emit(i.end);
        } else if (i === null) {
            // Do nothing.
        } else {
            this.chunk(i.start, i.text, i.type);
        }
    }
}
