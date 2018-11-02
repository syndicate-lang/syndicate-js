"use strict";
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

// Monkeypatch Babel in an utterly horrible way to support Syndicate
// syntactic extensions to JS.

//---------------------------------------------------------------------------
// (0) Replace the `isStatement` and `isExpression` functions with
// non-hard-coded versions that check the contents of
// FLIPPED_ALIAS_KEYS at the time of each call.
//
// This allows our later extensions to be picked up correctly.
//
var Validators = require("@babel/types/lib/validators/generated");
var shallowEqual = require("@babel/types/lib/utils/shallowEqual");

function _isX(X, previous) {
  return (node, opts) => {
    if (node && Types.FLIPPED_ALIAS_KEYS[X].indexOf(node.type) !== -1) {
      return typeof opts === "undefined" || shallowEqual.default(node, opts);
    } else {
      return previous(node, opts);
    }
  };
}

Validators.isStatement = _isX("Statement", Validators.isStatement);
Validators.isExpression = _isX("Expression", Validators.isExpression);

//---------------------------------------------------------------------------
// (1) Load the core parser in modifiable form.
//
// We do this by, in the build scripts, COPYING the parser COMPILED
// code, and MODIFYING it to add a couple of new exports. See
// `../babel_parser_suffix.js`.
//
// Here, then, we load the MODIFIED copy of the parser, and then
// PRE-POPULATE THE REQUIRE CACHE with it. Later requires of the
// ACTUAL module will then get our MODIFIED copy.
//
// Vile.
//
var BabelParser = require("./babel_parser");
require.cache[require.resolve("@babel/parser")] = require.cache[require.resolve("./babel_parser")];

//---------------------------------------------------------------------------
// (2) Install the new AST node types required.
//
// We do this by loading and populating the core TYPES array, and then
// loading our extensions, followed by RESETTING the TYPES array to
// include the new extensions as well as the original definitions.
//
var Types = require("@babel/types");
require("./types");
//
// Now reset the TYPES array. This code is roughly equivalent to the
// declaration of TYPES in babel-types/src/definitions/index.js:
//
//     const TYPES: Array<string> = Object.keys(VISITOR_KEYS)
//       .concat(Object.keys(FLIPPED_ALIAS_KEYS))
//       .concat(Object.keys(DEPRECATED_KEYS));
//
Types.TYPES.splice(0);
Array.prototype.push.apply(Types.TYPES, Object.keys(Types.VISITOR_KEYS));
Array.prototype.push.apply(Types.TYPES, Object.keys(Types.FLIPPED_ALIAS_KEYS));
Array.prototype.push.apply(Types.TYPES, Object.keys(Types.DEPRECATED_KEYS));

//---------------------------------------------------------------------------
// (3) Install our modified parser in place of the core parser.
//
// This makes use of the modification we installed from
// `../babel_parser_suffix.js` in step (1).
//
// It overrides the parser's notion of its root class -- effectively,
// the Syndicate parser becomes a mixin.
//
BabelParser.__setParser(require("./parser").default);

//---------------------------------------------------------------------------
// (4) Install generators for the new AST node types.
//
// This is mostly optional, unless for some reason we want only the
// syntax extension but not the transform (e.g. if the plugin omitted
// its `visitor`).
var Generators = require("@babel/generator/lib/generators");
var SyndicateGenerators = require("./generators");
Object.keys(SyndicateGenerators).forEach((f) => {
  Generators[f] = SyndicateGenerators[f];
});

//---------------------------------------------------------------------------
// (5) At this point, we should (?) be able to load and use Babel
// somewhat normally.
