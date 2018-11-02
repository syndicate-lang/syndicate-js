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
  builder: ["name", "body"],
  visitor: ["name", "body"],
  aliases: ["Statement"],
  fields: {
    name: {
      validate: assertNodeType("Expression"),
      optional: true,
    },
    body: {
      validate: assertNodeType("Statement"),
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
  builder: ["template", "test"],
  visitor: ["template", "test"],
  aliases: ["Statement"],
  fields: {
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
  builder: ["terminal", "triggerType", "pattern", "body"],
  visitor: ["terminal", "triggerType", "pattern", "body"],
  aliases: ["Statement"],
  fields: {
    terminal: {
      validate: assertOneOf(true, false),
    },
    triggerType: {
      validate: assertOneOf("asserted", "retracted", "message", "dataflow"),
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
      validate: assertNodeType("StringLiteral"),
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
