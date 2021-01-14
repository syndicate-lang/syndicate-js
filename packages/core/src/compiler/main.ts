import fs from 'fs';
import * as S from '../syntax/index.js';
import * as G from './grammar.js';

export function main(argv: string[]) {
    let [ inputFilename ] = argv.slice(2);
    inputFilename = inputFilename ?? '/dev/stdin';
    const source = fs.readFileSync(inputFilename, 'utf-8');

    const scanner = new S.StringScanner(S.startPos(inputFilename), source);
    const reader = new S.LaxReader(scanner);
    let tree = reader.readToEnd();
    let macro = new S.Templates();

    let expansionNeeded = true;
    function expand<T>(p: S.Pattern<T>, f: (t: T) => S.Items) {
        tree = S.replace(tree, p, t => {
            expansionNeeded = true;
            return f(t);
        });
    }
    while (expansionNeeded) {
        expansionNeeded = false;
        expand(G.spawn,
               s => macro.template()`SPAWN[${s.name ?? []}][${S.joinItems(s.initialAssertions, ', ')}][[${s.bootProcBody}]]`);
        expand(G.fieldDeclarationStatement,
               s => macro.template()`FIELD[${s.member}][${s.expr ?? []}]`);
        expand(G.assertionEndpointStatement,
               s => macro.template()`ASSERT[${''+s.isDynamic}][${s.template}][${s.test ?? []}]`);
        expand(G.dataflowStatement,
               e => macro.template()`DATAFLOW[${e}]`);
        expand(G.eventHandlerEndpointStatement,
               s => macro.template()`EVENTHANDLER[${`${s.terminal}/${s.isDynamic}`}][${s.triggerType}][${s.pattern}][${s.body}]`);
        expand(G.typeDefinitionStatement,
               s => macro.template()`TYPEDEF[${s.expectedUse}][${[s.label]}][${S.joinItems(s.fields.map(f => [f]), ' -- ')}][${s.wireName ?? []}]`);
        expand(G.messageSendStatement,
               e => macro.template()`SEND[${e}]`);
        expand(G.duringStatement,
               s => macro.template()`DURING[${s.pattern}][${s.body}]`);
        expand(G.reactStatement,
               e => macro.template()`REACT[${e}]`);
    }

    console.log(S.itemText(tree, { color: true, missing: '\x1b[41m□\x1b[0m' }));

    const cw = new S.CodeWriter(inputFilename);
    cw.emit(tree);
    fs.writeFileSync('/tmp/adhoc.syndicate', cw.text);
    const mm = cw.map;
    mm.sourcesContent = [source];
    fs.writeFileSync('/tmp/adhoc.syndicate.map', JSON.stringify(mm));
}
