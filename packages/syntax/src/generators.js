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

import * as t from "@babel/types";

export function SpawnStatement(node) {
  this.word("spawn");
  this.space();
  if (node.name) {
    this.word("named");
    this.space();
    this.print(node.name, node);
    this.space();
  }
  this.printBlock(node);
}

export function FieldDeclarationStatement(node) {
  this.word("field");
  this.space();
  this.print(node.member, node);
  if (node.init) {
    this.space();
    this.token("=");
    this.space();
    this.print(node.init, node);
  }
  this.semicolon();
}

export function AssertionEndpointStatement(node) {
  this.word("assert");
  this.space();
  this.print(node.template, node);
  if (node.test) {
    this.space();
    this.word("when");
    this.space();
    this.token("(");
    this.print(node.test, node);
    this.token(")");
  }
  this.semicolon();
}

export function DataflowStatement(node) {
  this.word("dataflow");
  this.space();
  this.print(node.body, node);
}

export function EventHandlerEndpoint(node) {
  if (node.terminal) {
    this.word("stop");
    this.space();
  }
  this.word("on");
  this.space();
  if (node.triggerType === "dataflow") {
    this.token("(");
    this.print(node.pattern, node);
    this.token(")");
  } else {
    this.word(node.triggerType);
    this.space();
    this.print(node.pattern, node);
  }
  this.space();
  this.print(node.body, node);
}

export function PseudoEventHandler(node) {
  this.word("on");
  this.space();
  this.word(node.triggerType);
  this.space();
  this.print(node.body, node);
}

export function SyndicateTypeDefinition(node) {
  this.word(node.expectedUse);
  this.space();
  this.word("type");
  this.space();
  this.print(node.id, node);
  this.token("(");
  this._parameters(node.formals, node);
  this.token(")");
  if (node.wireName) {
    this.space();
    this.token("=");
    this.space();
    this.print(node.wireName, node);
  }
  this.semicolon();
}

export function MessageSendStatement(node) {
  this.token("<<");
  this.space();
  this.print(node.body, node);
  this.semicolon();
}

export function ActivationExpression(node) {
  this.word("activate");
  this.space();
  this.print(node.moduleExpr, node);
}
