import {
    isToken, isTokenType, replace, commaJoin, startPos, fixPos, joinItems, anonymousTemplate,

    Items, Pattern, Templates, Substitution, TokenType,
    SourceMap, StringScanner, LaxReader, CodeWriter, TemplateFunction, Token,
} from '../syntax/index.js';
import {
    FacetAction, Statement,

    compilePattern,
    patternText,

    spawn,
    fieldDeclarationStatement,
    assertionEndpointStatement,
    dataflowStatement,
    eventHandlerEndpointStatement,
    duringStatement,
    typeDefinitionStatement,
    messageSendStatement,
    reactStatement,
    bootStatement,
    stopStatement,
    Identifier,
    activationImport,
    ActivationImport,
} from './grammar.js';
import {
    BootProc,
} from './internals.js';

export function stripShebang(items: Items): Items {
    if ((items.length > 0) &&
        isToken(items[0]) &&
        items[0].text.startsWith('#!')) {
        while (items.length > 0 && !isTokenType(items[0], TokenType.NEWLINE)) items.shift();
    }
    return items;
}

export type ModuleType ='es6' | 'require' | 'global';

export interface CompileOptions {
    source: string,
    name?: string,
    runtime?: string,
    module?: ModuleType,
    global?: string,
    typescript?: boolean,
}

export interface CompilerOutput {
    text: string,
    map: SourceMap,
}

function receiverFor(s: FacetAction): Substitution {
    return (s.implicitFacet) ? 'thisFacet.' : '.';
}

export interface ActivationRecord {
    activation: ActivationImport;
    activationScriptId: Identifier;
}

export class ExpansionContext {
    readonly moduleType: ModuleType;
    readonly activationRecords: Array<ActivationRecord> = [];
    hasBootProc: boolean = false;
    readonly typescript: boolean;

    constructor(moduleType: ModuleType,
                typescript: boolean)
    {
        this.moduleType = moduleType;
        this.typescript = typescript;
    }

    argDecl(name: Substitution, type: Substitution): Substitution {
        return this.typescript ? anonymousTemplate`${name}: ${type}` : name;
    }

    get thisFacetDecl(): Substitution {
        return this.argDecl('thisFacet', '__SYNDICATE__.Facet');
    }
}

export function expand(tree: Items, ctx: ExpansionContext): Items {
    const macro = new Templates();

    function terminalWrap(t: TemplateFunction, isTerminal: boolean, body: Statement): Statement {
        if (isTerminal) {
            return t`thisFacet._stop(function (${ctx.thisFacetDecl}) {${body}})`
        } else {
            return body;
        }
    }

    function x<T>(p: Pattern<T>, f: (v: T, t: TemplateFunction) => Items) {
        tree = replace(tree, p, (v, start) => f(v, macro.template(fixPos(start))));
    }

    function xf<T extends FacetAction>(p: Pattern<T>, f: (v: T, t: TemplateFunction) => Items) {
        x(p, (v, t) => t`${receiverFor(v)}${f(v, t)}`);
    }

    const walk = (tree: Items): Items => expand(tree, ctx);
    const maybeWalk = (tree?: Items) : Items | undefined => (tree === void 0) ? tree : walk(tree);

    xf(duringStatement, (s, t) => {
        // TODO: spawn during
        const sa = compilePattern(s.pattern);
        return t`withSelfDo(function (${ctx.thisFacetDecl}) {
                   const _Facets = new __SYNDICATE__.Dictionary();
                   on asserted ${patternText(s.pattern)} => react {
                     _Facets.set([${commaJoin(sa.captureIds.map(t=>[t]))}], thisFacet);
                     dataflow void 0; // TODO: horrible hack to keep the facet alive if no other endpoints
                     ${s.body}
                   }
                   on retracted ${patternText(s.pattern)} => {
                     const _Key = [${commaJoin(sa.captureIds.map(t=>[t]))}];
                     _Facets.get(_Key)._stop();
                     _Facets.delete(_Key);
                   }
                 });`;
    });

    xf(spawn, (s, t) => {
        let proc = t`function (${ctx.thisFacetDecl}) {${walk(s.bootProcBody)}}`;
        if (s.isDataspace) proc = t`__SYNDICATE__.inNestedDataspace(${proc})`;
        let assertions = (s.initialAssertions.length > 0)
            ? t`, new __SYNDICATE__.Set([${commaJoin(s.initialAssertions.map(walk))}])`
            : ``;
        return t`_spawn(${maybeWalk(s.name) ?? 'null'}, ${proc}${assertions});`;
    });

    xf(fieldDeclarationStatement, (s, t) => {
        const prop = ('name' in s.property)
            ? [ { start: s.property.name.start,
                  end: s.property.name.end,
                  type: TokenType.STRING,
                  text: JSON.stringify(s.property.name.text) } ]
            : walk(s.property.expr);
        return t`declareField(${walk(s.target)}, ${prop}, ${maybeWalk(s.init) ?? 'void 0'});`;
    });

    xf(assertionEndpointStatement, (s, t) => {
        if (s.test == void 0) {
            return t`addEndpoint(thisFacet => ({ assertion: ${walk(s.template)}, analysis: null }));`;
        } else {
            return t`addEndpoint(thisFacet => (${walk(s.test)})
                       ? ({ assertion: ${walk(s.template)}, analysis: null })
                       : ({ assertion: void 0, analysis: null }), ${''+s.isDynamic});`;
        }
    });

    xf(dataflowStatement, (s, t) => t`addDataflow(function (${ctx.thisFacetDecl}) {${walk(s.body)}});`);

    xf(eventHandlerEndpointStatement, (s, t) => {
        switch (s.triggerType) {
            case 'dataflow':
                return t`withSelfDo(function (${ctx.thisFacetDecl}) { dataflow { if (${walk(s.predicate)}) { ${terminalWrap(t, s.terminal, walk(s.body))} } } });`;

            case 'start':
            case 'stop': {
                const m = s.triggerType === 'start' ? 'addStartScript' : 'addStopScript';
                return t`${m}(function (${ctx.thisFacetDecl}) {${walk(s.body)}});`;
            }

            case 'asserted':
            case 'retracted':
            case 'message': {
                const sa = compilePattern(s.pattern);
                const expectedEvt = ({
                    'asserted': 'ADDED',
                    'retracted': 'REMOVED',
                    'message': 'MESSAGE',
                })[s.triggerType];
                return t`addEndpoint(thisFacet => ({
                           assertion: __SYNDICATE__.Observe(${walk(sa.assertion)}),
                           analysis: {
                             skeleton: ${walk(sa.skeleton)},
                             constPaths: ${JSON.stringify(sa.constPaths)},
                             constVals: [${commaJoin(sa.constVals.map(walk))}],
                             capturePaths: ${JSON.stringify(sa.capturePaths)},
                             callback: thisFacet.wrap((thisFacet, __Evt, [${commaJoin(sa.captureIds.map(i=>[i]))}]) => {
                               if (__Evt === __SYNDICATE__.Skeleton.EventType.${expectedEvt}) {
                                 thisFacet.scheduleScript(() => {${terminalWrap(t, s.terminal, walk(s.body))}});
                               }
                             })
                           }
                         }), ${'' + s.isDynamic});`;
            }
        }
    });

    x(typeDefinitionStatement, (s, t) => {
        const l = JSON.stringify(s.label.text);
        const fs = JSON.stringify(s.fields.map(f => f.text));
        return t`const ${[s.label]} = __SYNDICATE__.Record.makeConstructor(${maybeWalk(s.wireName) ?? l}, ${fs});`;
    });

    xf(messageSendStatement, (s, t) => t`_send(${walk(s.expr)});`);

    xf(reactStatement, (s, t) => t`addChildFacet(function (${ctx.thisFacetDecl}) {${walk(s.body)}});`);

    x(activationImport, (s, t) => {
        const activationScriptId: Token = {
            start: s.activationKeyword.start,
            end: s.activationKeyword.end,
            text: `__SYNDICATE__activationScript${'' + ctx.activationRecords.length}`,
            type: TokenType.ATOM
        };
        ctx.activationRecords.push({ activation: s, activationScriptId });
        return [];
    }),

    x(bootStatement, (s, t) => {
        ctx.hasBootProc = true;
        const activationStatements = ctx.activationRecords.map(({ activationScriptId: id }) =>
            t`thisFacet.activate(${[id]}); `);
        const body = t`${joinItems(activationStatements)}${walk(s)}`;
        switch (ctx.moduleType) {
            case 'es6':
                return t`export function ${BootProc}(${ctx.thisFacetDecl}) {${body}}`;
            case 'require':
                return t`module.exports.${BootProc} = function (${ctx.thisFacetDecl}) {${body}};`;
            case 'global':
                return t`function ${BootProc}(${ctx.thisFacetDecl}) {${body}}`;
        }
    });

    xf(stopStatement, (s, t) => t`_stop(function (${ctx.thisFacetDecl}) {${walk(s.body)}});`)

    return tree;
}

export function compile(options: CompileOptions): CompilerOutput {
    const inputFilename = options.name ?? '/dev/stdin';
    const source = options.source;
    const moduleType = options.module ?? 'es6';
    const typescript = options.typescript ?? false;

    const start = startPos(inputFilename);
    const scanner = new StringScanner(start, source);
    const reader = new LaxReader(scanner);
    let tree = stripShebang(reader.readToEnd());
    const end = tree.length > 0 ? tree[tree.length - 1].end : start;

    let macro = new Templates();

    const ctx = new ExpansionContext(moduleType, typescript);

    tree = expand(tree, ctx);

    const ts = macro.template(fixPos(start));
    const te = macro.template(fixPos(end));

    if (ctx.hasBootProc) {
        let bp;
        switch (moduleType) {
            case 'es6':
            case 'global':
                bp = BootProc;
                break;
            case 'require':
                bp = te`module.exports.${BootProc}`;
                break;
        }
        tree = te`${tree}\nif (typeof module !== 'undefined' && ((typeof require === 'undefined' ? {main: void 0} : require).main === module)) __SYNDICATE__.bootModule(${bp});`;
    }

    const activationImports = ctx.activationRecords.map(r => {
        const a = r.activation;
        const t = macro.template(a.activationKeyword.start);
        switch (a.target.type) {
            case 'import':
                return t`import { ${BootProc} as ${[r.activationScriptId]} } from ${[a.target.moduleName]};\n`;
            case 'expr':
                return t`const ${[r.activationScriptId]} = (${a.target.moduleExpr}).${BootProc};\n`;
        }
    });
    tree = ts`${joinItems(activationImports)}${tree}`;

    {
        const runtime = options.runtime ?? '@syndicate-lang/core';
        switch (moduleType) {
            case 'es6':
                tree = ts`import * as __SYNDICATE__ from ${JSON.stringify(runtime)};\n${tree}`;
                break;
            case 'require':
                tree = ts`const __SYNDICATE__ = require(${JSON.stringify(runtime)});\n${tree}`;
                break;
            case 'global':
                tree = ts`const __SYNDICATE__ = ${runtime};\n${tree}`;
                break;
        }
    }

    const cw = new CodeWriter(inputFilename);
    cw.emit(tree);

    return {
        text: cw.text,
        map: cw.map,
    };
}
