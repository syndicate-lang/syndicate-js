import {
    Item, Items,
    Pattern,

    scope, bind, seq, alt, upTo, atom, group, exec,
    repeat, option, withoutSpace, map, rest, discard,
    value,

} from '../syntax/index.js';
import * as Matcher from '../syntax/matcher.js';

export type Expr = Items;
export type Statement = Items;
export type Identifier = Item;

export const block = (acc?: Items) =>
    (acc === void 0)
    ? group('{', discard)
    : group('{', map(rest, items => acc.push(... items)));

export const statementBoundary = alt(atom(';'), Matcher.newline, Matcher.end);
export const exprBoundary = alt(atom(';'), atom(','), group('{', discard), Matcher.end);

export interface SpawnStatement {
    isDataspace: boolean;
    name?: Expr;
    initialAssertions: Expr[];
    parentIds: Identifier[];
    parentInits: Expr[];
    bootProcBody: Statement;
}

export const identifier: Pattern<Identifier> = atom();

export function expr(... extraStops: Pattern<any>[]): Pattern<Expr> {
    return withoutSpace(upTo(alt(exprBoundary, ... extraStops)));
}

export function statement(acc: Items): Pattern<void> {
    return alt(group('{', map(rest, items => acc.push(... items))),
               withoutSpace(seq(map(upTo(statementBoundary), items => acc.push(... items)),
                                map(statementBoundary, i => i ? acc.push(i) : void 0))));
}

export const spawn: Pattern<SpawnStatement> & { headerExpr: Pattern<Expr> } =
    Object.assign(scope((o: SpawnStatement) => {
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

export interface FieldDeclarationStatement {
    member: Expr;
    expr?: Expr;
}

export const fieldDeclarationStatement: Pattern<FieldDeclarationStatement> =
    scope(o => seq(atom('field'),
                   bind(o, 'member', expr(atom('='))),
                   option(seq(atom('='), bind(o, 'expr', expr())))));

export interface AssertionEndpointStatement {
    isDynamic: boolean,
    template: Expr,
    test?: Expr,
}

export const assertionEndpointStatement: Pattern<AssertionEndpointStatement> =
    scope(o => {
        o.isDynamic = true;
        return seq(atom('assert'),
                   option(map(atom(':snapshot'), _ => o.isDynamic = false)),
                   bind(o, 'template', expr(seq(atom('when'), group('(', discard)))),
                   option(seq(atom('when'), group('(', bind(o, 'test', expr())))));
    });

export const dataflowStatement: Pattern<Statement> =
    value(o => {
        o.value = [];
        return seq(atom('dataflow'), statement(o.value));
    });

export interface EventHandlerEndpointStatement {
    terminal: boolean;
    triggerType: 'dataflow' | 'start' | 'stop' | 'asserted' | 'retracted' | 'message';
    isDynamic: boolean;
    pattern?: Expr;
    body: Statement;
}

export const eventHandlerEndpointStatement: Pattern<EventHandlerEndpointStatement> =
    scope(o => {
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
                           bind(o, 'pattern', expr()),
                           option(statement(o.body)))));
    });

export interface TypeDefinitionStatement {
    expectedUse: 'message' | 'assertion';
    label: Identifier;
    fields: Identifier[];
    wireName?: Expr;
}

export const typeDefinitionStatement: Pattern<TypeDefinitionStatement> =
    scope(o => seq(bind(o, 'expectedUse', map(alt(atom('message'), atom('assertion')), e => e.text)),
                   atom('type'),
                   bind(o, 'label', identifier),
                   group('(', bind(o, 'fields', repeat(identifier, { separator: atom(',') }))),
                   option(seq(atom('='),
                              bind(o, 'wireName', withoutSpace(upTo(statementBoundary))))),
                   statementBoundary));

export const messageSendStatement: Pattern<Expr> =
    value(o => seq(atom('send'), bind(o, 'value', withoutSpace(upTo(statementBoundary))), statementBoundary));

export interface DuringStatement {
    pattern: Expr;
    body: Statement;
}

export const duringStatement: Pattern<DuringStatement> =
    scope(o => {
        o.body = [];
        return seq(atom('during'),
                   bind(o, 'pattern', expr()),
                   statement(o.body));
    });

export const reactStatement: Pattern<Statement> =
    value(o => {
        o.value = [];
        return seq(atom('react'), statement(o.value));
    });
