import * as S from '../syntax/index.js';
import { Substitution } from '../syntax/index.js';
import * as G from './grammar.js';
import { BootProc } from './internals.js';

export function stripShebang(items: S.Items): S.Items {
    if ((items.length > 0) &&
        S.isToken(items[0]) &&
        items[0].text.startsWith('#!')) {
        while (items.length > 0 && !S.isTokenType(items[0], S.TokenType.NEWLINE)) items.shift();
    }
    return items;
}

export interface CompileOptions {
    source: string,
    name?: string,
    runtime?: string,
    module?: 'es6' | 'require' | 'global',
    global?: string,
}

export interface CompilerOutput {
    text: string,
    map: S.SourceMap,
}

export function compile(options: CompileOptions): CompilerOutput {
    const inputFilename = options.name ?? '/dev/stdin';
    const source = options.source;
    const moduleType = options.module ?? 'es6';

    const scanner = new S.StringScanner(S.startPos(inputFilename), source);
    const reader = new S.LaxReader(scanner);
    let tree = stripShebang(reader.readToEnd());
    let macro = new S.Templates();

    const runtime = options.runtime ?? '@syndicate/core';
    switch (moduleType) {
        case 'es6':
            tree = macro.template()`import * as __SYNDICATE__ from ${JSON.stringify(runtime)};\n${tree}`;
            break;
        case 'require':
            tree = macro.template()`const __SYNDICATE__ = require(${JSON.stringify(runtime)});\n${tree}`;
            break;
        case 'global':
            tree = macro.template()`const __SYNDICATE__ = ${runtime};\n${tree}`;
            break;
    }

    let passNumber = 0;
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

    function terminalWrap(isTerminal: boolean, body: G.Statement): G.Statement {
        if (isTerminal) {
            return macro.template()`thisFacet._stop(function (thisFacet) {${body}})`
        } else {
            return body;
        }
    }

    while (expansionNeeded) {
        if (++passNumber >= 128) {
            throw new Error(`Too many compiler passes (${passNumber})!`);
        }

        // console.log(`\n\n\n======================================== PASS ${passNumber}\n`);
        // console.log(S.itemText(tree, { color: true, missing: '\x1b[41m□\x1b[0m' }));

        expansionNeeded = false;
        expandFacetAction(
            G.spawn,
            s => {
                let proc = macro.template()`function (thisFacet) {${s.bootProcBody}}`;
                if (s.isDataspace) proc = macro.template()`__SYNDICATE__.inNestedDataspace(${proc})`;
                let assertions = (s.initialAssertions.length > 0)
                    ? macro.template()`, new __SYNDICATE__.Set([${S.commaJoin(s.initialAssertions)}])`
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
            s => {
                if (s.test == void 0) {
                    return macro.template()`addEndpoint(thisFacet => ({ assertion: ${s.template}, analysis: null }));`;
                } else {
                    return macro.template()`addEndpoint(thisFacet => (${s.test ?? 'true'})
                                              ? ({ assertion: ${s.template}, analysis: null })
                                              : ({ assertion: void 0, analysis: null }), ${''+s.isDynamic});`;
                }
            });
        expandFacetAction(
            G.dataflowStatement,
            s => macro.template()`addDataflow(function (thisFacet) {${s.body}});`);
        expandFacetAction(
            G.eventHandlerEndpointStatement,
            s => {
                switch (s.triggerType) {
                    case 'dataflow':
                        return macro.template()`withSelfDo(function (thisFacet) { dataflow { if (${s.predicate}) { ${terminalWrap(s.terminal, s.body)} } } });`;

                    case 'start':
                    case 'stop': {
                        const m = s.triggerType === 'start' ? 'addStartScript' : 'addStopScript';
                        return macro.template()`${m}(function (thisFacet) {${s.body}});`;
                    }

                    case 'asserted':
                    case 'retracted':
                    case 'message': {
                        const sa = G.compilePattern(s.pattern);
                        const expectedEvt = ({
                            'asserted': 'ADDED',
                            'retracted': 'REMOVED',
                            'message': 'MESSAGE',
                        })[s.triggerType];
                        return macro.template()`addEndpoint(thisFacet => ({
  assertion: __SYNDICATE__.Observe(${sa.assertion}),
  analysis: {
    skeleton: ${sa.skeleton},
    constPaths: ${JSON.stringify(sa.constPaths)},
    constVals: [${S.commaJoin(sa.constVals)}],
    capturePaths: ${JSON.stringify(sa.capturePaths)},
    callback: thisFacet.wrap((thisFacet, __Evt, [${S.commaJoin(sa.captureIds.map(i=>[i]))}]) => {
      if (__Evt === __SYNDICATE__.Skeleton.EventType.${expectedEvt}) {
        thisFacet.scheduleScript(() => {${terminalWrap(s.terminal, s.body)}});
      }
    })
  }
}), ${'' + s.isDynamic});`;
                    }
                }
            });
        expandFacetAction(
            G.duringStatement,
            s => {
                // TODO: spawn during
                const sa = G.compilePattern(s.pattern);
                return macro.template()`withSelfDo(function (thisFacet) {
  const _Facets = new __SYNDICATE__.Dictionary();
  on asserted ${G.patternText(s.pattern)} => react {
    _Facets.set([${S.commaJoin(sa.captureIds.map(t=>[t]))}], thisFacet);
    dataflow void 0; // TODO: horrible hack to keep the facet alive if no other endpoints
    ${s.body}
  }
  on retracted ${G.patternText(s.pattern)} => {
    const _Key = [${S.commaJoin(sa.captureIds.map(t=>[t]))}];
    _Facets.get(_Key)._stop();
    _Facets.delete(_Key);
  }
});`;
            });
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
            s => {
                switch (moduleType) {
                    case 'es6':
                        return macro.template()`export function ${BootProc}(thisFacet) {${s}}`;
                    case 'global':
                        return macro.template()`module.exports.${BootProc} = function (thisFacet) {${s}};`;
                    case 'require':
                        return macro.template()`function ${BootProc}(thisFacet) {${s}}`;
                }
            });
        expandFacetAction(
            G.stopStatement,
            s => macro.template()`_stop(function (thisFacet) {${s.body}});`);
    }

    // console.log(`\n\n\n======================================== FINAL OUTPUT\n`);
    // console.log(S.itemText(tree));

    const cw = new S.CodeWriter(inputFilename);
    cw.emit(tree);

    return {
        text: cw.text,
        map: cw.map,
    };
}
