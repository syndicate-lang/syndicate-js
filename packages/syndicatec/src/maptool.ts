import fs from 'fs';
import { SourceMap } from '@syndicate-lang/compiler/lib/syntax/index.js';
import { Syntax } from '@syndicate-lang/compiler';
const { vlqDecode } = Syntax;

export function main(argv: string[]) {
    const mapFilename = argv[0];
    console.log(mapFilename);
    const map = JSON.parse(fs.readFileSync(mapFilename, 'utf-8')) as SourceMap;
    console.log(map);

    const entries = map.mappings.split(/;/).map(e => e.split(/,/).map(vlqDecode));
    entries.forEach((line, lineNumber) =>
        console.log(lineNumber + 1, line));
}
