import {
    isToken, isTokenType, replace, commaJoin, startPos, fixPos, joinItems,
    anonymousTemplate, laxRead, itemText,

    Items, Pattern, Templates, Substitution, TokenType,
    SourceMap, CodeWriter, TemplateFunction, Token, SpanIndex,
} from '../syntax/index.js';
import {
    SyndicateParser, SyndicateTypedParser,
    Identifier,
    FacetAction,
    Statement,
    ActivationImport,
    FacetFields,
    Binder,

    compilePattern,
    patternText,
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
    targetToSourceMap: SpanIndex<Token>;
    sourceToTargetMap: SpanIndex<number>;
}

function receiverFor(s: FacetAction): Substitution {
    return (s.implicitFacet) ? 'thisFacet.' : '.';
}

export interface ActivationRecord {
    activation: ActivationImport;
    activationScriptId: Identifier;
}

export class ExpansionContext {
    readonly parser: SyndicateParser;
    readonly moduleType: ModuleType;
    readonly activationRecords: Array<ActivationRecord> = [];
    hasBootProc: boolean = false;
    readonly typescript: boolean;
    _collectedFields: FacetFields | null = null;

    constructor(moduleType: ModuleType,
                typescript: boolean)
    {
        this.parser = typescript ? new SyndicateTypedParser : new SyndicateParser();
        this.moduleType = moduleType;
        this.typescript = typescript;
    }

    argDecl(name: Substitution, type: Substitution): Substitution {
        return this.typescript ? anonymousTemplate`${name}: ${type}` : name;
    }

    get collectedFields(): FacetFields {
        // Allocates a transient array for collected fields in
        // contexts lacking a surrounding collector - that is, for errors.
        return this._collectedFields ?? [];
    }

    collectField(f: Binder) {
        this.collectedFields.push(f);
    }

    withCollectedFields<T>(fs: FacetFields, f: () => T): T {
        const oldCollectedFields = this._collectedFields;
        try {
            this._collectedFields = fs;
            return f();
        } finally {
            this._collectedFields = oldCollectedFields;
        }
    }
}

function stringifyId(i: Identifier): Items {
    return [ { ... i, type: TokenType.STRING, text: JSON.stringify(i.text) } ];
}

function facetFieldObjectType(t: TemplateFunction, fs: FacetFields): Substitution {
    function formatBinder(binder: Binder) {
        const hasType = (binder.type !== void 0);
        return t`${[binder.id]}${hasType ? ': ': ''}${binder.type ?? ''}`;
    }
    return t`{${commaJoin(fs.map(formatBinder))}}`;
}

function binderTypeGuard(t: TemplateFunction): (binder: Binder) => Items {
    return (binder) => {
        if (binder.type === void 0) {
            return t`${`/* ${binder.id.text} is a plain Value */`}`;
        } else {
            const typeText = itemText(binder.type);
            switch (typeText) {
                case 'boolean':
                case 'string':
                case 'number':
                case 'symbol':
                    return t`if (typeof (${[binder.id]}) !== ${JSON.stringify(typeText)}) return;\n`;
                default:
                    throw new Error(`Unhandled binding type: ${JSON.stringify(typeText)}`);
            }
        }
    };
}

export function expand(tree: Items, ctx: ExpansionContext): Items {
    const macro = new Templates();

    function terminalWrap(t: TemplateFunction, isTerminal: boolean, body: Statement): Statement {
        if (isTerminal) {
            return t`thisFacet._stop(function (thisFacet) {${body}})`
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

    xf(ctx.parser.duringStatement, (s, t) => {
        // TODO: spawn during
        const sa = compilePattern(s.pattern);
        const body = ctx.withCollectedFields(s.facetFields, () => walk(s.body));
        return t`withSelfDo(function (thisFacet) {
                   const _Facets = new __SYNDICATE__.Dictionary();
                   on asserted ${patternText(s.pattern)} => react {
                     _Facets.set([${commaJoin(sa.captureBinders.map(t=>[t.id]))}], thisFacet);
                     dataflow void 0; // TODO: horrible hack to keep the facet alive if no other endpoints
                     ${body}
                   }
                   on retracted ${patternText(s.pattern)} => {
                     const _Key = [${commaJoin(sa.captureBinders.map(t=>[t.id]))}];
                     _Facets.get(_Key)._stop();
                     _Facets.delete(_Key);
                   }
                 });`;
    });

    xf(ctx.parser.spawn, (s, t) => {
        let body = ctx.withCollectedFields(s.facetFields, () => walk(s.body));
        let proc = t`function (thisFacet) {${body}}`;
        if (s.isDataspace) proc = t`__SYNDICATE__.inNestedDataspace(${proc})`;
        let assertions = (s.initialAssertions.length > 0)
            ? t`, new __SYNDICATE__.Set([${commaJoin(s.initialAssertions.map(walk))}])`
            : ``;
        let fieldTypeParam = ctx.typescript ? t`<${facetFieldObjectType(t, s.facetFields)}>` : '';
        return t`_spawn${fieldTypeParam}(${maybeWalk(s.name) ?? 'null'}, ${proc}${assertions});`;
    });

    xf(ctx.parser.fieldDeclarationStatement, (s, t) => {
        ctx.collectField(s.property);
        return t`declareField(this, ${stringifyId(s.property.id)}, ${maybeWalk(s.init) ?? 'void 0'});`;
    });

    xf(ctx.parser.assertionEndpointStatement, (s, t) => {
        if (s.test == void 0) {
            return t`addEndpoint(thisFacet => ({ assertion: ${walk(s.template)}, analysis: null }));`;
        } else {
            return t`addEndpoint(thisFacet => (${walk(s.test)})
                       ? ({ assertion: ${walk(s.template)}, analysis: null })
                       : ({ assertion: void 0, analysis: null }), ${''+s.isDynamic});`;
        }
    });

    xf(ctx.parser.dataflowStatement, (s, t) =>
        t`addDataflow(function (thisFacet) {${walk(s.body)}});`);

    xf(ctx.parser.eventHandlerEndpointStatement, (s, t) => {
        switch (s.triggerType) {
            case 'dataflow':
                return t`withSelfDo(function (thisFacet) { dataflow { if (${walk(s.predicate)}) { ${terminalWrap(t, s.terminal, walk(s.body))} } } });`;

            case 'start':
            case 'stop': {
                const m = s.triggerType === 'start' ? 'addStartScript' : 'addStopScript';
                return t`${m}(function (thisFacet) {${walk(s.body)}});`;
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
                const destructure = sa.captureBinders.length === 0 ? '__vs'
                    : t`[${commaJoin(sa.captureBinders.map(i=>[i.id]))}]`;
                return t`addEndpoint(thisFacet => ({
                           assertion: __SYNDICATE__.Observe(${walk(sa.assertion)}),
                           analysis: {
                             skeleton: ${walk(sa.skeleton)},
                             constPaths: ${JSON.stringify(sa.constPaths)},
                             constVals: [${commaJoin(sa.constVals.map(walk))}],
                             capturePaths: ${JSON.stringify(sa.capturePaths)},
                             callback: thisFacet.wrap((thisFacet, __Evt, ${destructure}) => {
                               if (__Evt === __SYNDICATE__.Skeleton.EventType.${expectedEvt}) {
${ctx.typescript ? joinItems(sa.captureBinders.map(binderTypeGuard(t)), '\n') : ''}
                                 thisFacet.scheduleScript(() => {${terminalWrap(t, s.terminal, walk(s.body))}});
                               }
                             })
                           }
                         }), ${'' + s.isDynamic});`;
            }
        }
    });

    x(ctx.parser.typeDefinitionStatement, (s, t) => {
        const l = JSON.stringify(s.label.text);
        const fs = JSON.stringify(s.fields.map(f => f.id.text));
        return t`const ${[s.label]} = __SYNDICATE__.Record.makeConstructor(${maybeWalk(s.wireName) ?? l}, ${fs});`;
    });

    xf(ctx.parser.messageSendStatement, (s, t) => t`_send(${walk(s.expr)});`);

    xf(ctx.parser.reactStatement, (s, t) => {
        const body = ctx.withCollectedFields(s.facetFields, () => walk(s.body));
        const fieldTypeParam = ctx.typescript
            ? t`<${facetFieldObjectType(t, ctx.collectedFields)}, ${facetFieldObjectType(t, s.facetFields)}>`
            : '';
        return t`addChildFacet${fieldTypeParam}(function (thisFacet) {${body}});`;
    });

    x(ctx.parser.activationImport, (s) => {
        const activationScriptId: Token = {
            start: s.activationKeyword.start,
            end: s.activationKeyword.end,
            text: `__SYNDICATE__activationScript${'' + ctx.activationRecords.length}`,
            type: TokenType.ATOM
        };
        ctx.activationRecords.push({ activation: s, activationScriptId });
        return [];
    }),

    x(ctx.parser.bootStatement, (s, t) => {
        ctx.hasBootProc = true;
        const activationStatements = ctx.activationRecords.map(({ activationScriptId: id }) =>
            t`thisFacet.activate(${[id]}); `);
        const body = t`${joinItems(activationStatements)}${walk(s)}`;
        const facetDecl = ctx.typescript ? 'thisFacet: __SYNDICATE__.Facet<{}>' : 'thisFacet';
        switch (ctx.moduleType) {
            case 'es6':
                return t`export function ${BootProc}(${facetDecl}) {${body}}`;
            case 'require':
                return t`module.exports.${BootProc} = function (${facetDecl}) {${body}};`;
            case 'global':
                return t`function ${BootProc}(${facetDecl}) {${body}}`;
        }
    });

    xf(ctx.parser.stopStatement, (s, t) =>
        t`_stop(function (thisFacet) {${walk(s.body)}});`)

    return tree;
}

export function compile(options: CompileOptions): CompilerOutput {
    const inputFilename = options.name ?? '/dev/stdin';

    // console.info(`Syndicate: compiling ${inputFilename}`);

    const source = options.source;
    const moduleType = options.module ?? 'es6';
    const typescript = options.typescript ?? false;

    const start = startPos(inputFilename);
    let tree = stripShebang(laxRead(source, { start, extraDelimiters: ':' }));
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


    const text = cw.text;

    return {
        text,
        map: cw.map,
        targetToSourceMap: cw.targetToSourceMap.index(),
        sourceToTargetMap: cw.sourceToTargetMap.index(),
    };
}
