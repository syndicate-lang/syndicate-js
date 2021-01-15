import fs from 'fs';
import * as S from '../syntax/index.js';
import { ArrayList, Substitution } from '../syntax/index.js';
import * as G from './grammar.js';
import { BootProc } from './internals.js';

export function main(argv: string[]) {
    let [ inputFilename ] = argv.slice(2);
    inputFilename = inputFilename ?? '/dev/stdin';
    const source = fs.readFileSync(inputFilename, 'utf-8');

    const scanner = new S.StringScanner(S.startPos(inputFilename), source);
    const reader = new S.LaxReader(scanner);
    let tree = reader.readToEnd();
    let macro = new S.Templates();

    tree = macro.template()`import * as __SYNDICATE__ from '@syndicate/core';\n${tree}`;

    let passNumber = 1;
    let expansionNeeded = true;
    function expand<T>(p: S.Pattern<T>, f: (t: T) => S.Items) {
        tree = S.replace(tree, p, t => {
            expansionNeeded = true;
            return f(t);
        });
    }

    function receiverFor(s: G.FacetAction): Substitution {
        return (s.implicitFacet) ? 'thisFacet.' : '.';
    }

    function expandFacetAction<T extends G.FacetAction>(p: S.Pattern<T>, f: (t: T) => S.Items) {
        expand(p, t => macro.template()`${receiverFor(t)}${f(t)}`);
    }

    while (expansionNeeded) {
        if (passNumber >= 128) {
            throw new Error(`Too many compiler passes (${passNumber})!`);
        }
        expansionNeeded = false;
        expandFacetAction(
            G.spawn,
            s => {
                let proc = macro.template()`function (thisFacet) {${s.bootProcBody}}`;
                if (s.isDataspace) proc = macro.template()`__SYNDICATE__.inNestedDataspace(${proc})`;
                let assertions = (s.initialAssertions.length > 0)
                    ? macro.template()`, new __SYNDICATE__.Set([${S.joinItems(s.initialAssertions, ', ')}])`
                    : ``;
                return macro.template()`_spawn(${s.name ?? 'null'}, ${proc}${assertions});`;
            });
        expandFacetAction(
            G.fieldDeclarationStatement,
            s => {
                const prop = ('name' in s.property)
                    ? [ { start: s.property.name.start,
                          end: s.property.name.end,
                          type: S.TokenType.STRING,
                          text: JSON.stringify(s.property.name.text) } ]
                    : s.property.expr;
                return macro.template()`declareField(${s.target}, ${prop}, ${s.init ?? 'void 0'});`;
            });
        expandFacetAction(
            G.assertionEndpointStatement,
            s => macro.template()`addEndpoint(thisFacet => (${s.test ?? 'true'}) && (${s.template}), ${''+s.isDynamic});`);
        expandFacetAction(
            G.dataflowStatement,
            s => macro.template()`addDataflow(function (thisFacet) {${s.body}});`);
        expandFacetAction(
            G.eventHandlerEndpointStatement,
            s => {
                return macro.template()`EVENTHANDLER[${`${s.terminal}/${s.isDynamic}`}][${s.triggerType}][${s.pattern ?? []}][${s.body}]`;
            });
        expandFacetAction(
            G.duringStatement,
            s => macro.template()`DURING[${s.pattern}][${s.body}]`);
        expand(
            G.typeDefinitionStatement,
            s => {
                const l = JSON.stringify(s.label.text);
                const fs = JSON.stringify(s.fields.map(f => f.text));
                return macro.template()`const ${[s.label]} = __SYNDICATE__.Record.makeConstructor(${s.wireName ?? l}, ${fs});`;
            });
        expandFacetAction(
            G.messageSendStatement,
            s => macro.template()`_send(${s.expr});`);
        expandFacetAction(
            G.reactStatement,
            s => macro.template()`addChildFacet(function (thisFacet) {${s.body}});`);
        expand(
            G.bootStatement,
            s => macro.template()`export function ${BootProc}(thisFacet) {${s}}`);
        expandFacetAction(
            G.stopStatement,
            s => macro.template()`_stop(function (thisFacet) {${s.body}});`);
    }

    console.log(S.itemText(tree, { color: true, missing: '\x1b[41m□\x1b[0m' }));

    const cw = new S.CodeWriter(inputFilename);
    cw.emit(tree);
    fs.writeFileSync('/tmp/adhoc.syndicate', cw.text);
    const mm = cw.map;
    mm.sourcesContent = [source];
    fs.writeFileSync('/tmp/adhoc.syndicate.map', JSON.stringify(mm));
}
