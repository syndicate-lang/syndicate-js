import {
    TokenType, Token, Items,
    Pattern,
    foldItems, match, anonymousTemplate as template, commaJoin,
    startPos,

    scope, bind, seq, alt, upTo, atom, atomString, group, exec,
    repeat, option, withoutSpace, map, mapm, rest, discard,
    value, succeed, fail, separatedBy, anything, not, follows,
} from '../syntax/index.js';
import * as Matcher from '../syntax/matcher.js';
import { Path, Skeleton } from './internals.js';

//---------------------------------------------------------------------------
// AST types

export type Expr = Items;
export type Statement = Items;
export type Identifier = Token;
export type Type = Items;
export type Binder = { id: Identifier, type?: Type };

export interface FacetAction {
    implicitFacet: boolean;
}

export type FacetFields = Binder[];

export interface FacetProducingAction extends FacetAction {
    body: Statement;
    facetFields: FacetFields;
}

export interface SpawnStatement extends FacetProducingAction {
    isDataspace: boolean;
    name?: Expr;
    initialAssertions: Expr[];
    parentBinders: Binder[];
    parentInits: Expr[];
}

export interface FieldDeclarationStatement extends FacetAction {
    property: Binder;
    init?: Expr;
}

export interface AssertionEndpointStatement extends FacetAction {
    isDynamic: boolean,
    template: Expr,
    test?: Expr,
}

export interface StatementFacetAction extends FacetAction {
    body: Statement;
}

export interface GenericEventEndpointStatement extends StatementFacetAction {
    terminal: boolean;
    isDynamic: boolean;
}

export interface DataflowEndpointStatement extends GenericEventEndpointStatement {
    triggerType: 'dataflow';
    predicate: Expr;
}

export interface PseudoEventEndpointStatement extends GenericEventEndpointStatement {
    triggerType: 'start' | 'stop';
}

export interface AssertionEventEndpointStatement extends GenericEventEndpointStatement {
    triggerType: 'asserted' | 'retracted' | 'message';
    pattern: ValuePattern;
}

export type EventHandlerEndpointStatement =
    DataflowEndpointStatement | PseudoEventEndpointStatement | AssertionEventEndpointStatement;

export interface TypeDefinitionStatement {
    expectedUse: 'message' | 'assertion';
    label: Identifier;
    fields: Binder[];
    wireName?: Expr;
}

export interface MessageSendStatement extends FacetAction {
    expr: Expr;
}

export interface DuringStatement extends FacetProducingAction {
    pattern: ValuePattern;
}

export interface ReactStatement extends FacetProducingAction {
}

export interface ActivationImport {
    activationKeyword: Identifier;
    target: { type: 'import', moduleName: Token } | { type: 'expr', moduleExpr: Expr };
}

//---------------------------------------------------------------------------
// Value pattern AST types

export interface PCapture {
    type: 'PCapture',
    binder: Binder,
    inner: ValuePattern,
}

export interface PDiscard {
    type: 'PDiscard',
}

export interface PConstructor {
    type: 'PConstructor',
    ctor: Expr,
    arguments: ValuePattern[],
}

export interface PConstant {
    type: 'PConstant',
    value: Expr,
}

export interface PArray {
    type: 'PArray',
    elements: ValuePattern[],
}

export type ValuePattern = PCapture | PDiscard | PConstructor | PConstant | PArray;

interface RawCall {
    items: Items;
    callee: Expr;
    arguments: Expr[];
}

export interface StaticAnalysis {
    skeleton: Expr;
    constPaths: Path[];
    constVals: Expr[];
    capturePaths: Path[];
    captureBinders: Binder[];
    assertion: Expr;
}

//---------------------------------------------------------------------------
// Parsers

export class SyndicateParser {
    block(acc?: Items): Pattern<Items> {
        return group('{', map(rest, items => (acc?.push(... items), items)));
    }

    readonly statementBoundary = alt<any>(atom(';'), Matcher.newline);
    readonly exprBoundary = alt<any>(atom(';'), atom(','), group('{', discard), Matcher.end);

    readonly identifier: Pattern<Identifier> = atom();
    get binder(): Pattern<Binder> { return scope(o => bind(o, 'id', this.identifier)); }

    expr(... extraStops: Pattern<any>[]): Pattern<Expr> {
        return withoutSpace(upTo(alt(this.exprBoundary, ... extraStops)));
    }

    readonly type: (... extraStops: Pattern<any>[]) => Pattern<Type> = this.expr;

    statement(acc: Items): Pattern<any> {
        return alt<any>(this.block(acc),
                        withoutSpace(seq(map(upTo(this.statementBoundary),
                                             items => acc.push(... items)),
                                         map(this.statementBoundary,
                                             i => i ? acc.push(i) : void 0))));
    }

    facetAction<T extends FacetAction>(pattern: (scope: T) => Pattern<any>): Pattern<T> {
        return i => {
            const scope = Object.create(null);
            scope.implicitFacet = true;
            const p = seq(option(map(atom('.'), _ => scope.implicitFacet = false)), pattern(scope));
            const r = p(i);
            if (r === null) return null;
            return [scope, r[1]];
        };
    }

    readonly headerExpr = this.expr(atom(':asserting'), atom(':let'));

    // Principal: Facet
    readonly spawn: Pattern<SpawnStatement> =
        this.facetAction(o => {
            o.isDataspace = false;
            o.initialAssertions = [];
            o.parentBinders = [];
            o.parentInits = [];
            o.body = [];
            o.facetFields = [];
            return seq(atom('spawn'),
                       option(seq(atom('dataspace'), exec(() => o.isDataspace = true))),
                       option(seq(atom('named'),
                                  bind(o, 'name', this.headerExpr))),
                       repeat(alt(seq(atom(':asserting'),
                                      map(this.headerExpr, e => o.initialAssertions.push(e))),
                                  map(scope((l: { b: Binder, init: Expr }) =>
                                      seq(atom(':let'),
                                          bind(l, 'b', this.binder),
                                          atom('='),
                                          bind(l, 'init', this.headerExpr))),
                                      l => {
                                          o.parentBinders.push(l.b);
                                          o.parentInits.push(l.init);
                                      }))),
                       this.block(o.body));
        });

    // Principal: Dataspace, but only for implementation reasons, so really Facet
    readonly fieldDeclarationStatement: Pattern<FieldDeclarationStatement> =
        this.facetAction(o => {
            return seq(atom('field'),
                       bind(o, 'property', this.binder),
                       option(seq(atom('='), bind(o, 'init', this.expr()))),
                       this.statementBoundary);
        });

    // Principal: Facet
    readonly assertionEndpointStatement: Pattern<AssertionEndpointStatement> =
        this.facetAction(o => {
            o.isDynamic = true;
            return seq(atom('assert'),
                       option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                       bind(o, 'template', this.expr(seq(atom('when'), group('(', discard)))),
                       option(seq(atom('when'), group('(', bind(o, 'test', this.expr())))),
                       this.statementBoundary);
        });

    blockFacetAction(kw: Pattern<any>): Pattern<StatementFacetAction> {
        return this.facetAction(o => {
            o.body = [];
            return seq(kw, this.block(o.body));
        });
    }

    // Principal: Facet
    readonly dataflowStatement = this.blockFacetAction(atom('dataflow'));

    mandatoryIfNotTerminal(o: GenericEventEndpointStatement, p: Pattern<any>): Pattern<any> {
        return i => {
            return (o.terminal) ? option(p)(i) : p(i);
        };
    }

    // Principal: Facet
    readonly eventHandlerEndpointStatement: Pattern<EventHandlerEndpointStatement> =
        this.facetAction(o => {
            o.terminal = false;
            o.isDynamic = true;
            o.body = [];
            return seq(option(map(atom('stop'), _ => o.terminal = true)),
                       atom('on'),
                       alt<any>(seq(map(group('(', bind(o as DataflowEndpointStatement, 'predicate',
                                                        this.expr())),
                                        _ => o.triggerType = 'dataflow'),
                                    this.mandatoryIfNotTerminal(o, this.statement(o.body))),
                                mapm(seq(bind(o, 'triggerType',
                                              alt(atomString('start'), atomString('stop'))),
                                         option(this.statement(o.body))),
                                     v => o.terminal ? fail : succeed(v)),
                                seq(bind(o, 'triggerType',
                                         alt(atomString('asserted'),
                                             atomString('retracted'),
                                             atomString('message'))),
                                    option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                                    bind(o as AssertionEventEndpointStatement, 'pattern',
                                         this.valuePattern(atom('=>'))),
                                    this.mandatoryIfNotTerminal(
                                        o, seq(atom('=>'), this.statement(o.body))))));
        });

    // Principal: none
    readonly typeDefinitionStatement: Pattern<TypeDefinitionStatement> =
        scope(o => seq(bind(o, 'expectedUse', alt(atomString('message'), atomString('assertion'))),
                       atom('type'),
                       bind(o, 'label', this.identifier),
                       group('(', bind(o, 'fields',
                                       repeat(this.binder, { separator: atom(',') }))),
                       option(seq(atom('='),
                                  bind(o, 'wireName', withoutSpace(upTo(this.statementBoundary))))),
                       this.statementBoundary));

    // Principal: Facet
    readonly messageSendStatement: Pattern<MessageSendStatement> =
        this.facetAction(o => seq(atom('send'),
                                  atom('message'),
                                  not(this.statementBoundary),
                                  bind(o, 'expr', withoutSpace(upTo(this.statementBoundary))),
                                  this.statementBoundary));

    // Principal: Facet
    readonly duringStatement: Pattern<DuringStatement> =
        this.facetAction(o => {
            o.body = [];
            o.facetFields = [];
            return seq(atom('during'),
                       bind(o, 'pattern', this.valuePattern(atom('=>'))),
                       seq(atom('=>'), this.statement(o.body)));
        });

    // Principal: Facet
    readonly reactStatement: Pattern<ReactStatement> =
        this.facetAction(o => {
            o.body = [];
            o.facetFields = [];
            return seq(atom('react'), this.block(o.body));
        });

    // Principal: none
    readonly bootStatement: Pattern<Statement> =
        value(o => {
            o.value = [];
            return seq(atom('boot'), this.block(o.value));
        });

    // Principal: Facet
    readonly stopStatement = this.blockFacetAction(atom('stop'));

    // Principal: none
    readonly activationImport: Pattern<ActivationImport> =
        scope(o => seq(bind(o, 'activationKeyword', atom('activate')),
                       follows(alt<any>(seq(atom('import'),
                                            upTo(seq(
                                                map(atom(void 0, { tokenType: TokenType.STRING }),
                                                    n => o.target = {
                                                        type: 'import',
                                                        moduleName: n
                                                    }),
                                                this.statementBoundary))),
                                        map(this.expr(), e => o.target = {
                                            type: 'expr',
                                            moduleExpr: e
                                        })))));

    //---------------------------------------------------------------------------
    // Syntax of patterns over Value, used in endpoints

    readonly pCaptureBinder: Pattern<Binder> =
        mapm(this.binder, i => {
            return i.id.text.startsWith('$')
                ? succeed({ id: { ... i.id, text: i.id.text.slice(1) }, type: i.type })
                : fail;
        });

    readonly pDiscard: Pattern<void> =
        mapm(this.identifier, i => i.text === '_' ? succeed(void 0) : fail);

    hasCapturesOrDiscards(e: Expr): boolean {
        return foldItems(e,
                         t => match(alt<any>(this.pCaptureBinder, this.pDiscard), [t], null) !== null,
                         (_g, b, _k) => b,
                         bs => bs.some(b => b));
    }

    // $id - capture of discard
    // _ - discard
    //
    // expr(pat, ...) - record ctor
    // $id(pat) - nested capture
    // [pat, ...] - array pat
    //
    // expr(expr, ...) - constant
    // [expr, ...] - constant
    // other - constant

    pRawCall(... extraStops: Pattern<any>[]): Pattern<RawCall> {
        return scope((o: RawCall) =>
            seq(bind(o, 'callee',
                     this.expr(seq(group('(', discard),
                                   alt(this.exprBoundary, ... extraStops)))),
                seq(map(anything({ advance: false }),
                        g => o.items = [... o.callee, g]),
                    group('(', bind(o, 'arguments',
                                    separatedBy(this.expr(), atom(',')))))));
    }

    isConstant(o: RawCall): boolean {
        return (!(this.hasCapturesOrDiscards(o.callee) ||
            o.arguments.some(a => this.hasCapturesOrDiscards(a))));
    }

    valuePattern(... extraStops: Pattern<any>[]): Pattern<ValuePattern> {
        return alt<ValuePattern>(
            scope<PCapture>(o => {
                o.type = 'PCapture';
                o.inner = { type: 'PDiscard' };
                return bind(o, 'binder', this.pCaptureBinder);
            }),
            scope(o => map(this.pDiscard, _ => o.type = 'PDiscard')),
            mapm<RawCall, ValuePattern>(
                this.pRawCall(... extraStops),
                o => {
                    if (this.isConstant(o)) {
                        return succeed({ type: 'PConstant', value: o.items });
                    } else if (this.hasCapturesOrDiscards(o.callee)) {
                        const r = match(this.pCaptureBinder, o.callee, null);
                        if (r !== null && o.arguments.length === 1)
                        {
                            const argPat = match(this.valuePattern(), o.arguments[0], null);
                            if (argPat === null) return fail;
                            return succeed({
                                type: 'PCapture',
                                inner: argPat,
                                binder: r
                            });
                        } else {
                            return fail;
                        }
                    } else {
                        const argPats = o.arguments.map(a => match(this.valuePattern(), a, null));
                        if (argPats.some(p => p === null)) return fail;
                        return succeed({
                            type: 'PConstructor',
                            ctor: o.callee,
                            arguments: argPats as ValuePattern[]
                        });
                    }
                }),
            map(this.expr(), e => ({ type: 'PConstant', value: e }))
        );
    }
}

export class SyndicateTypedParser extends SyndicateParser {
    get binder(): Pattern<Binder> {
        return scope(o => seq(bind(o, 'id', this.identifier),
                              option(seq(atom(':'),
                                         bind(o, 'type', this.type(atom('=')))))));
    }
}

//---------------------------------------------------------------------------
// Value pattern utilities

export function patternText(p: ValuePattern): Items {
    switch (p.type) {
        case 'PDiscard': return template`_`;
        case 'PConstant': return p.value;
        case 'PCapture':
            {
                const binderId = { ... p.binder.id, text: '$' + p.binder.id.text };
                const affix =
                    (p.inner.type === 'PDiscard') ? [] : template`(${patternText(p.inner)})`;
                if (p.binder.type !== void 0) {
                    return template`${[binderId]}:${p.binder.type}${affix}`;
                } else {
                    return template`${[binderId]}${affix}`;
                }
            }
        case 'PArray': return template`[${commaJoin(p.elements.map(patternText))}]`;
        case 'PConstructor': return template`${p.ctor}(${commaJoin(p.arguments.map(patternText))})`;
    }
}

const eDiscard: Expr = template`(__SYNDICATE__.Discard._instance)`;
const eCapture = (e: Expr): Expr => template`(__SYNDICATE__.Capture(${e}))`;

export function compilePattern(pattern: ValuePattern): StaticAnalysis {
    const constPaths: Path[] = [];
    const constVals: Expr[] = [];
    const capturePaths: Path[] = [];
    const captureBinders: Binder[] = [];

    const currentPath: Path = [];

    function walk(pattern: ValuePattern): [Skeleton<Expr>, Expr] {
        switch (pattern.type) {
            case 'PDiscard':
                return [null, eDiscard];
            case 'PCapture': {
                capturePaths.push(currentPath.slice());
                captureBinders.push(pattern.binder);
                const [s, a] = walk(pattern.inner);
                return [s, eCapture(a)];
            }
            case 'PConstant':
                constVals.push(pattern.value);
                return [null, pattern.value];
            case 'PConstructor': {
                const skel: Skeleton<Expr> = {
                    shape: template`__SYNDICATE__.Skeleton.constructorInfoSignature((${pattern.ctor}).constructorInfo)`,
                    members: [],
                };
                const assertionArgs: Expr[] = [];
                pattern.arguments.forEach((argPat, i) => {
                    currentPath.push(i);
                    const [s, a] = walk(argPat);
                    skel.members.push(s);
                    assertionArgs.push(a);
                    currentPath.pop();
                });
                return [skel, template`(${pattern.ctor}(${commaJoin(assertionArgs)}))`];
            }
            case 'PArray': {
                const skel: Skeleton<Expr> = {
                    shape: [ {
                        start: startPos(null),
                        end: startPos(null),
                        type: TokenType.STRING,
                        text: JSON.stringify(pattern.elements.length.toString()),
                    } ],
                    members: []
                };
                const elements: Expr[] = [];
                pattern.elements.forEach((elemPat, i) => {
                    currentPath.push(i);
                    const [s, a] = walk(elemPat);
                    skel.members.push(s);
                    elements.push(a);
                    currentPath.pop();
                });
                return [skel, template`[${commaJoin(elements)}]`];
            }
        }
    }

    const [skeletonStructure, assertion] = walk(pattern);
    const skeleton = renderSkeleton(skeletonStructure);

    return {
        skeleton,
        constPaths,
        constVals,
        capturePaths,
        captureBinders,
        assertion,
    };
}

function renderSkeleton(skel: Skeleton<Expr>): Expr {
    if (skel === null) {
        return template`null`;
    } else {
        return template`({shape:${skel.shape}, members: [${commaJoin(skel.members.map(renderSkeleton))}]})`;
    }
}
