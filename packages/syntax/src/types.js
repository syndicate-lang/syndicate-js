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

import defineType, {
  assertEach,
  assertNodeType,
  assertValueType,
  assertOneOf,
  chain,
} from "@babel/types/lib/definitions/utils";

defineType("SpawnStatement", {
  builder: ["name", "initialAssertions", "parentIds", "parentInits", "bootProc", "isDataspace"],
  visitor: ["name", "initialAssertions", "parentIds", "parentInits", "bootProc"],
  aliases: ["Statement", "Scopable"],
  fields: {
    name: {
      validate: assertNodeType("Expression"),
      optional: true,
    },
    initialAssertions: {
      validate: chain(
        assertValueType("array"),
        assertEach(assertNodeType("Expression")),
      ),
    },
    parentIds: {
      validate: chain(assertValueType("array"), assertEach(assertNodeType("Identifier")),),
    },
    parentInits: {
      validate: chain(assertValueType("array"), assertEach(assertNodeType("Expression")),),
    },
    bootProc: {
      validate: assertNodeType("FunctionExpression"),
    },
    isDataspace: {
      validate: assertOneOf(true, false),
    },
  },
});

defineType("FieldDeclarationStatement", {
  builder: ["member", "init"],
  visitor: ["member", "init"],
  aliases: ["Statement"],
  fields: {
    member: {
      validate: assertNodeType("MemberExpression"),
    },
    init: {
      validate: assertNodeType("Expression"),
      optional: true,
    },
  },
});

defineType("AssertionEndpointStatement", {
  builder: ["isDynamic", "template", "test"],
  visitor: ["isDynamic", "template", "test"],
  aliases: ["Statement"],
  fields: {
    isDynamic: {
      validate: assertOneOf(true, false),
    },
    template: {
      validate: assertNodeType("Expression"),
    },
    test: {
      validate: assertNodeType("Expression"),
      optional: true,
    },
  },
});

defineType("DataflowStatement", {
  builder: ["body"],
  visitor: ["body"],
  aliases: ["Statement"],
  fields: {
    body: {
      validate: assertNodeType("Statement"),
    },
  },
});

defineType("EventHandlerEndpoint", {
  builder: ["terminal", "triggerType", "isDynamic", "pattern", "body"],
  visitor: ["terminal", "triggerType", "isDynamic", "pattern", "body"],
  aliases: ["Statement", "Scopable"],
  fields: {
    terminal: {
      validate: assertOneOf(true, false),
    },
    triggerType: {
      validate: assertOneOf("asserted", "retracted", "message", "dataflow"),
    },
    isDynamic: {
      validate: assertOneOf(true, false),
    },
    pattern: {
      validate: assertNodeType("Expression"),
    },
    body: {
      validate: assertNodeType("Statement"),
    },
  }
});

defineType("PseudoEventHandler", {
  builder: ["triggerType", "body"],
  visitor: ["triggerType", "body"],
  aliases: ["Statement"],
  fields: {
    triggerType: {
      validate: assertOneOf("start", "stop"),
    },
    body: {
      validate: assertNodeType("Statement"),
    },
  }
});

defineType("SyndicateTypeDefinition", {
  builder: ["expectedUse", "id", "formals", "wireName"],
  visitor: ["expectedUse", "id", "formals", "wireName"],
  aliases: ["Statement"],
  fields: {
    expectedUse: {
      validate: assertOneOf("message", "assertion"),
    },
    id: {
      validate: assertNodeType("Identifier"),
    },
    formals: {
      validate: chain(
        assertValueType("array"),
        assertEach(assertNodeType("Identifier")),
      ),
    },
    wireName: {
      validate: assertNodeType("Expression"),
      optional: true,
    },
  }
});

defineType("MessageSendStatement", {
  builder: ["body"],
  visitor: ["body"],
  aliases: ["Statement"],
  fields: {
    body: {
      validate: assertNodeType("Expression"),
    },
  },
});

defineType("ActivationExpression", {
  builder: ["moduleExpr"],
  visitor: ["moduleExpr"],
  aliases: ["Expression"],
  fields: {
    moduleExpr: {
      validate: assertNodeType("Expression"),
    },
  },
});

defineType("DuringStatement", {
  builder: ["pattern", "body"],
  visitor: ["pattern", "body"],
  aliases: ["Statement", "Scopable"],
  fields: {
    pattern: {
      validate: assertNodeType("Expression"),
    },
    body: {
      validate: assertNodeType("Statement"),
    },
  },
});

defineType("SyndicateReactStatement", {
  builder: ["bodyProc"],
  visitor: ["bodyProc"],
  aliases: ["Statement"],
  fields: {
    bodyProc: {
      validate: assertNodeType("FunctionExpression"),
    },
  },
});
