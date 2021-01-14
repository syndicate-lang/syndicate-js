export interface Pos {
    line: number;
    column: number;
    pos: number;
    name: string | null;
}

export function startPos(name: string | null): Pos {
    return { line: 1, column: 0, pos: 0, name };
}

export function advancePos(p: Pos, ch: string): boolean {
    let advancedLine = false;
    p.pos++;
    switch (ch) {
        case '\t':
            p.column = (p.column + 8) & ~7;
            break;
        case '\n':
            p.column = 0;
            p.line++;
            advancedLine = true;
            break;
        case '\r':
            p.column = 0;
            break;
        default:
            p.column++;
            break;
    }
    return advancedLine;
}
