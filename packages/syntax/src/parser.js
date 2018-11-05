//---------------------------------------------------------------------------
// @syndicate-lang/syntax, a translator of Syndicate extensions to JS.
// Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

import { _original_Parser, tokTypes as tt } from "@babel/parser";

export default class SyndicateParser extends _original_Parser {
  // Overrides ExpressionParser.parseMaybeAssign
  parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos) {
    let previousError = null;

    if (this.isContextual("activate")) {
      let result = this.withBacktracking(
        () => {
          this.next();
          const node = this.startNode();
          node.moduleExpr = this.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
          return this.finishNode(node, "ActivationExpression");
        },
        (err) => {
          previousError = err;
          return null;
        });
      if (result) return result;
    }

    try {
      return super.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
    } catch (err) {
      if (err instanceof SyntaxError && previousError && previousError.pos >= err.pos) {
        throw previousError;
      } else {
        throw err;
      }
    }
  }

  // Overrides StatementParser.parseStatementContent
  parseStatementContent(declaration, topLevel) {
    let previousError = null;

    switch (this.state.type) {
      case tt.bitwiseXOR:
        if (this.hasPlugin("syndicate")) {
          let result = this.withBacktracking(
            () => {
              this.next();
              const node = this.startNode();
              node.body = this.parseExpression();
              this.semicolon();
              return this.finishNode(node, "MessageSendStatement");
            },
            (err) => { previousError = err; return null; });
          if (result) return result;
        }
        break;

      case tt.name:
        if (this.hasPlugin("syndicate")) {
          let result = this.withBacktracking(
            () => {
              if (this.isContextual("field")) {
                this.next();
                const node = this.startNode();
                node.member = this.parseExprSubscripts();
                if (node.member.type !== "MemberExpression") {
                  this.raise(node.start, "Field declaration requires MemberExpression");
                }
                if (this.eat(tt.eq)) {
                  node.init = this.parseExpression();
                }
                this.semicolon();
                return this.finishNode(node, "FieldDeclarationStatement");
              }

              if (this.isContextual("spawn")) {
                return this.parseSpawnStatement();
              }

              if (this.isContextual("assert")) {
                this.next();
                const node = this.startNode();
                node.isDynamic = this.parseMaybeSnapshot();
                node.template = this.parseExpression();
                if (this.eatContextual("when")) {
                  this.expect(tt.parenL);
                  node.test = this.parseExpression();
                  this.expect(tt.parenR);
                }
                this.semicolon();
                return this.finishNode(node, "AssertionEndpointStatement");
              }

              if (this.isContextual("dataflow")) {
                this.next();
                const node = this.startNode();
                node.body = this.parseStatement();
                return this.finishNode(node, "DataflowStatement");
              }

              if (this.isContextual("stop")) {
                this.next();
                return this.parseEventHandlerEndpoint(true, false);
              }

              if (this.isContextual("on")) {
                return this.parseEventHandlerEndpoint(false, true);
              }

              if (this.isContextual("during")) {
                this.next();
                const node = this.startNode();
                node.pattern = this.parseExpression();
                if (this.isContextual("spawn")) {
                  node.body = this.parseSpawnStatement();
                } else {
                  node.body = this.parseStatement();
                }
                return this.finishNode(node, "DuringStatement");
              }

              if (this.isContextual("react")) {
                this.next();
                const node = this.startNode();
                node.body = this.parseStatement();
                return this.finishNode(node, "SyndicateReactStatement");
              }

              if (this.isContextual("assertion") || this.isContextual("message")) {
                const node = this.startNode();
                node.expectedUse = this.state.value;
                this.next();
                this.eatContextual("type");
                if (!this.match(tt.name)) { this.unexpected(null, tt.name); }
                node.id = this.parseIdentifier();
                this.parseFunctionParams(node); // eww
                node.formals = node.params;
                delete node.params; // eww
                if (this.eat(tt.eq)) {
                  if (!this.match(tt.string)) { this.unexpected(null, tt.string); }
                  node.wireName = this.parseLiteral(this.state.value, "StringLiteral");
                }
                this.semicolon();
                return this.finishNode(node, "SyndicateTypeDefinition");
              }

              return null;
            },
            (err) => {
              previousError = err;
              return null;
            });
          if (result) return result;
        }
    }

    try {
      return super.parseStatementContent(declaration, topLevel);
    } catch (err) {
      if (err instanceof SyntaxError && previousError && previousError.pos >= err.pos) {
        throw previousError;
      } else {
        throw err;
      }
    }
  }

  withBacktracking(alt1, alt2) {
    const state = this.state.clone();
    try {
      return alt1();
    } catch (err) {
      if (err instanceof SyntaxError) {
        this.state = state;
        return alt2(err);
      } else {
        throw err;
      }
    }
  }

  parseSpawnStatement() {
    this.next();
    const node = this.startNode();
    if (this.isContextual("named")) {
      this.next();
      node.name = this.parseExpression();
    }
    node.initialAssertions = [];
    while (this.match(tt.colon)) {
      this.next();
      this.expectContextual("asserting");
      node.initialAssertions.push(this.parseExpression());
    }
    node.body = this.parseStatement();
    return this.finishNode(node, "SpawnStatement");
  }

  parseEventHandlerEndpoint(terminal, pseudoEventsAllowed) {
    this.expectContextual("on");
    const node = this.startNode();

    if (this.match(tt.parenL)) {
      node.terminal = terminal;
      node.triggerType = "dataflow";
      node.isDynamic = true;
      node.pattern = this.parseExpression();
      node.body = this.parseStatement();
      return this.finishNode(node, "EventHandlerEndpoint");
    }

    if (!this.match(tt.name)) {
      this.unexpected(
        null,
        "Expected endpoint trigger type ("
          + (pseudoEventsAllowed ? "start/stop/" : "")
          + "asserted/retracted/message/(...))");
    }

    switch (this.state.value) {
      case "start":
      case "stop":
        node.triggerType = this.state.value;
        this.next();
        node.body = this.parseStatement();
        return this.finishNode(node, "PseudoEventHandler");

      case "asserted":
      case "retracted":
      case "message":
        node.triggerType = this.state.value;
        this.next();
        node.isDynamic = this.parseMaybeSnapshot();
        node.terminal = terminal;
        node.pattern = this.parseExpression();
        node.body = this.parseStatement();
        return this.finishNode(node, "EventHandlerEndpoint");

      default:
        this.unexpected(null, "Unknown event handler trigger type");
    }
  }

  parseMaybeSnapshot() {
    if (this.match(tt.colon)) {
      this.next();
      this.expectContextual("snapshot");
      return false;
    } else {
      return true;
    }
  }
}
