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

export type Expr = Items;
export type Statement = Items;
export type Identifier = Token;

export const block = (acc: Items) => group('{', map(rest, items => acc.push(... items)));

export const statementBoundary = alt<any>(atom(';'), Matcher.newline);
export const exprBoundary = alt<any>(atom(';'), atom(','), group('{', discard), Matcher.end);

export const identifier: Pattern<Identifier> = atom();

export function expr(... extraStops: Pattern<any>[]): Pattern<Expr> {
    return withoutSpace(upTo(alt(exprBoundary, ... extraStops)));
}

export function statement(acc: Items): Pattern<any> {
    return alt<any>(block(acc),
                    withoutSpace(seq(map(upTo(statementBoundary), items => acc.push(... items)),
                                     map(statementBoundary, i => i ? acc.push(i) : void 0))));
}

export interface FacetAction {
    implicitFacet: boolean;
}

export function facetAction<I extends FacetAction, T extends I>(
    pattern: (scope: T) => Pattern<any>): Pattern<T>
{
    return i => {
        const scope = Object.create(null);
        scope.implicitFacet = true;
        const p = seq(option(map(atom('.'), _ => scope.implicitFacet = false)), pattern(scope));
        const r = p(i);
        if (r === null) return null;
        return [scope, r[1]];
    };
}

export interface SpawnStatement extends FacetAction {
    isDataspace: boolean;
    name?: Expr;
    initialAssertions: Expr[];
    parentIds: Identifier[];
    parentInits: Expr[];
    bootProcBody: Statement;
}

export const spawn: Pattern<SpawnStatement> & { headerExpr: Pattern<Expr> } =
    Object.assign(facetAction((o: SpawnStatement) => {
        o.isDataspace = false;
        o.initialAssertions = [];
        o.parentIds = [];
        o.parentInits = [];
        o.bootProcBody = [];
        return seq(atom('spawn'),
                   option(seq(atom('dataspace'), exec(() => o.isDataspace = true))),
                   option(seq(atom('named'),
                              bind(o, 'name', spawn.headerExpr))),
                   repeat(alt(seq(atom(':asserting'),
                                  map(spawn.headerExpr, e => o.initialAssertions.push(e))),
                              map(scope((l: { id: Identifier, init: Expr }) =>
                                  seq(atom(':let'),
                                      bind(l, 'id', identifier),
                                      atom('='),
                                      bind(l, 'init', spawn.headerExpr))),
                                  l => {
                                      o.parentIds.push(l.id);
                                      o.parentInits.push(l.init);
                                  }))),
                   block(o.bootProcBody));
    }), {
        headerExpr: expr(atom(':asserting'), atom(':let')),
    });

export interface FieldDeclarationStatement extends FacetAction {
    target: Expr;
    property: { name: Identifier } | { expr: Expr };
    init?: Expr;
}

// Principal: Dataspace, but only for implementation reasons, so really Facet
export const fieldDeclarationStatement: Pattern<FieldDeclarationStatement> =
    facetAction(o => {
        const prop = alt(seq(atom('.'), map(identifier, name => o.property = {name})),
                         seq(group('[', map(expr(), expr => o.property = {expr}))));
        return seq(atom('field'),
                   bind(o, 'target', expr(seq(prop, alt(atom('='), statementBoundary)))),
                   prop,
                   option(seq(atom('='), bind(o, 'init', expr()))),
                   statementBoundary);
    });

export interface AssertionEndpointStatement extends FacetAction {
    isDynamic: boolean,
    template: Expr,
    test?: Expr,
}

// Principal: Facet
export const assertionEndpointStatement: Pattern<AssertionEndpointStatement> =
    facetAction(o => {
        o.isDynamic = true;
        return seq(atom('assert'),
                   option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                   bind(o, 'template', expr(seq(atom('when'), group('(', discard)))),
                   option(seq(atom('when'), group('(', bind(o, 'test', expr())))),
                   statementBoundary);
    });

export interface StatementFacetAction extends FacetAction {
    body: Statement;
}

export function blockFacetAction(kw: Pattern<any>): Pattern<StatementFacetAction> {
    return facetAction(o => {
        o.body = [];
        return seq(kw, block(o.body));
    });
}

// Principal: Facet
export const dataflowStatement = blockFacetAction(atom('dataflow'));

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

export function mandatoryIfNotTerminal(o: GenericEventEndpointStatement, p: Pattern<any>): Pattern<any> {
    return i => {
        return (o.terminal) ? option(p)(i) : p(i);
    };
}

// Principal: Facet
export const eventHandlerEndpointStatement: Pattern<EventHandlerEndpointStatement> =
    facetAction(o => {
        o.terminal = false;
        o.isDynamic = true;
        o.body = [];
        return seq(option(map(atom('stop'), _ => o.terminal = true)),
                   atom('on'),
                   alt<any>(seq(map(group('(', bind(o as DataflowEndpointStatement, 'predicate',
                                                    expr())),
                                    _ => o.triggerType = 'dataflow'),
                                mandatoryIfNotTerminal(o, statement(o.body))),
                            mapm(seq(bind(o, 'triggerType',
                                          alt(atomString('start'), atomString('stop'))),
                                     option(statement(o.body))),
                                 v => o.terminal ? fail : succeed(v)),
                            seq(bind(o, 'triggerType',
                                     alt(atomString('asserted'),
                                         atomString('retracted'),
                                         atomString('message'))),
                                option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                                bind(o as AssertionEventEndpointStatement, 'pattern',
                                     valuePattern(atom('=>'))),
                                mandatoryIfNotTerminal(o, seq(atom('=>'), statement(o.body))))));
    });

export interface TypeDefinitionStatement {
    expectedUse: 'message' | 'assertion';
    label: Identifier;
    fields: Identifier[];
    wireName?: Expr;
}

// Principal: none
export const typeDefinitionStatement: Pattern<TypeDefinitionStatement> =
    scope(o => seq(bind(o, 'expectedUse', alt(atomString('message'), atomString('assertion'))),
                   atom('type'),
                   bind(o, 'label', identifier),
                   group('(', bind(o, 'fields', repeat(identifier, { separator: atom(',') }))),
                   option(seq(atom('='),
                              bind(o, 'wireName', withoutSpace(upTo(statementBoundary))))),
                   statementBoundary));

export interface MessageSendStatement extends FacetAction {
    expr: Expr;
}

// Principal: Facet
export const messageSendStatement: Pattern<MessageSendStatement> =
    facetAction(o => seq(atom('send'),
                         atom('message'),
                         not(statementBoundary),
                         bind(o, 'expr', withoutSpace(upTo(statementBoundary))),
                         statementBoundary));

export interface DuringStatement extends FacetAction {
    pattern: ValuePattern;
    body: Statement;
}

// Principal: Facet
export const duringStatement: Pattern<DuringStatement> =
    facetAction(o => {
        o.body = [];
        return seq(atom('during'),
                   bind(o, 'pattern', valuePattern(atom('=>'))),
                   seq(atom('=>'), statement(o.body)));
    });

// Principal: Facet
export const reactStatement = blockFacetAction(atom('react'));

// Principal: none
export const bootStatement: Pattern<Statement> =
    value(o => {
        o.value = [];
        return seq(atom('boot'), block(o.value));
    });

// Principal: Facet
export const stopStatement = blockFacetAction(atom('stop'));

export interface ActivationImport {
    activationKeyword: Identifier;
    target: { type: 'import', moduleName: Token } | { type: 'expr', moduleExpr: Expr };
}

// Principal: none
export const activationImport: Pattern<ActivationImport> =
    scope(o => seq(bind(o, 'activationKeyword', atom('activate')),
                   follows(alt<any>(seq(atom('import'),
                                        upTo(seq(
                                            map(atom(void 0, { tokenType: TokenType.STRING }),
                                                n => o.target = { type: 'import', moduleName: n }),
                                            statementBoundary))),
                                    map(expr(), e => o.target = { type: 'expr', moduleExpr: e })))));

//---------------------------------------------------------------------------
// Syntax of patterns over Value, used in endpoints

export interface PCapture {
    type: 'PCapture',
    binder: Identifier,
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

const pCaptureId: Pattern<Identifier> =
    mapm(identifier, i => i.text.startsWith('$')
        ? succeed({ ... i, text: i.text.slice(1) })
        : fail);

const pDiscard: Pattern<void> = mapm(identifier, i => i.text === '_' ? succeed(void 0) : fail);

function hasCapturesOrDiscards(e: Expr): boolean {
    return foldItems(e,
                     t => match(alt<any>(pCaptureId, pDiscard), [t], null) !== null,
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

interface RawCall {
    items: Items;
    callee: Expr;
    arguments: Expr[];
}

function pRawCall(... extraStops: Pattern<any>[]): Pattern<RawCall> {
    return scope((o: RawCall) => seq(bind(o, 'callee',
                                          expr(seq(group('(', discard),
                                                   alt(exprBoundary, ... extraStops)))),
                                     seq(map(anything({ advance: false }),
                                             g => o.items = [... o.callee, g]),
                                         group('(', bind(o, 'arguments',
                                                         separatedBy(expr(), atom(',')))))));
}

function isConstant(o: RawCall) {
    return (!(hasCapturesOrDiscards(o.callee) || o.arguments.some(hasCapturesOrDiscards)));
}

export function valuePattern(... extraStops: Pattern<any>[]): Pattern<ValuePattern> {
    return alt<ValuePattern>(
        scope<PCapture>(o => {
            o.type = 'PCapture';
            o.inner = { type: 'PDiscard' };
            return bind(o, 'binder', pCaptureId);
        }),
        scope(o => map(pDiscard, _ => o.type = 'PDiscard')),
        mapm<RawCall, ValuePattern>(
            pRawCall(... extraStops),
            o => {
                if (isConstant(o)) {
                    return succeed({ type: 'PConstant', value: o.items });
                } else if (hasCapturesOrDiscards(o.callee)) {
                    const r = match(pCaptureId, o.callee, null);
                    if (r !== null && o.arguments.length === 1)
                    {
                        const argPat = match(valuePattern(), o.arguments[0], null);
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
                    const argPats = o.arguments.map(a => match(valuePattern(), a, null));
                    if (argPats.some(p => p === null)) return fail;
                    return succeed({
                        type: 'PConstructor',
                        ctor: o.callee,
                        arguments: argPats as ValuePattern[]
                    });
                }
            }),
        map(expr(), e => ({ type: 'PConstant', value: e }))
    );
}

export function patternText(p: ValuePattern): Items {
    switch (p.type) {
        case 'PDiscard': return template`_`;
        case 'PConstant': return p.value;
        case 'PCapture':
            {
                const binder = { ... p.binder, text: '$' + p.binder.text };
                if (p.inner.type === 'PDiscard') {
                    return [binder];
                } else {
                    return template`${[binder]}(${patternText(p.inner)})`;
                }
            }
        case 'PArray': return template`[${commaJoin(p.elements.map(patternText))}]`;
        case 'PConstructor': return template`${p.ctor}(${commaJoin(p.arguments.map(patternText))})`;
    }
}

export interface StaticAnalysis {
    skeleton: Expr;
    constPaths: Path[];
    constVals: Expr[];
    capturePaths: Path[];
    captureIds: Identifier[];
    assertion: Expr;
}

const eDiscard: Expr = template`(__SYNDICATE__.Discard._instance)`;
const eCapture = (e: Expr): Expr => template`(__SYNDICATE__.Capture(${e}))`;

export function compilePattern(pattern: ValuePattern): StaticAnalysis {
    const constPaths: Path[] = [];
    const constVals: Expr[] = [];
    const capturePaths: Path[] = [];
    const captureIds: Identifier[] = [];

    const currentPath: Path = [];

    function walk(pattern: ValuePattern): [Skeleton<Expr>, Expr] {
        switch (pattern.type) {
            case 'PDiscard':
                return [null, eDiscard];
            case 'PCapture': {
                capturePaths.push(currentPath.slice());
                captureIds.push(pattern.binder);
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
        captureIds,
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
