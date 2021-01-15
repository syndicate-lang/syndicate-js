import {
    Token, Items,
    Pattern,

    scope, bind, seq, alt, upTo, atom, group, exec,
    repeat, option, withoutSpace, map, rest, discard,
    value,

} from '../syntax/index.js';
import * as Matcher from '../syntax/matcher.js';

export type Expr = Items;
export type Statement = Items;
export type Identifier = Token;

export const block = (acc?: Items) =>
    (acc === void 0)
    ? group('{', discard)
    : group('{', map(rest, items => acc.push(... items)));

export const statementBoundary = alt(atom(';'), Matcher.newline, Matcher.end);
export const exprBoundary = alt(atom(';'), atom(','), group('{', discard), Matcher.end);

export const identifier: Pattern<Identifier> = atom();

export function expr(... extraStops: Pattern<any>[]): Pattern<Expr> {
    return withoutSpace(upTo(alt(exprBoundary, ... extraStops)));
}

export function statement(acc: Items): Pattern<void> {
    return alt(group('{', map(rest, items => acc.push(... items))),
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
                   statement(o.bootProcBody));
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

export function statementFacetAction(kw: Pattern<any>): Pattern<StatementFacetAction> {
    return facetAction(o => {
        o.body = [];
        return seq(kw, statement(o.body));
    });
}

// Principal: Facet
export const dataflowStatement = statementFacetAction(atom('dataflow'));

export interface EventHandlerEndpointStatement extends FacetAction {
    terminal: boolean;
    triggerType: 'dataflow' | 'start' | 'stop' | 'asserted' | 'retracted' | 'message';
    isDynamic: boolean;
    pattern?: Expr;
    body: Statement;
}

// Principal: Facet
export const eventHandlerEndpointStatement: Pattern<EventHandlerEndpointStatement> =
    facetAction(o => {
        o.terminal = false;
        o.isDynamic = true;
        o.body = [];
        return seq(option(map(atom('stop'), _ => o.terminal = true)),
                   atom('on'),
                   alt(map(group('(', bind(o, 'pattern', expr())), _ => o.triggerType = 'dataflow'),
                       seq(bind(o, 'triggerType',
                                map(alt(atom('start'), atom('stop')), e => e.text)),
                           option(statement(o.body))),
                       seq(bind(o, 'triggerType',
                                map(alt(atom('asserted'),
                                        atom('retracted'),
                                        atom('message')),
                                    e => e.text)),
                           option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                           bind(o, 'pattern', expr(atom('=>'))),
                           alt(seq(atom('=>'), statement(o.body)),
                               statementBoundary))));
    });

export interface TypeDefinitionStatement {
    expectedUse: 'message' | 'assertion';
    label: Identifier;
    fields: Identifier[];
    wireName?: Expr;
}

// Principal: none
export const typeDefinitionStatement: Pattern<TypeDefinitionStatement> =
    scope(o => seq(bind(o, 'expectedUse', map(alt(atom('message'), atom('assertion')), e => e.text)),
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
                         bind(o, 'expr', withoutSpace(upTo(statementBoundary))),
                         statementBoundary));

export interface DuringStatement extends FacetAction {
    pattern: Expr;
    body: Statement;
}

// Principal: Facet
export const duringStatement: Pattern<DuringStatement> =
    facetAction(o => {
        o.body = [];
        return seq(atom('during'),
                   bind(o, 'pattern', expr()),
                   statement(o.body));
    });

// Principal: Facet
export const reactStatement = statementFacetAction(atom('react'));

// Principal: none
export const bootStatement: Pattern<Statement> =
    value(o => {
        o.value = [];
        return seq(atom('boot'), statement(o.value));
    });

// Principal: Facet
export const stopStatement = statementFacetAction(atom('stop'));
