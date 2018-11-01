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

import { declare } from "@babel/helper-plugin-utils";
import { types as t } from "@babel/core";
import { cloneDeep } from "@babel/types";
import template from "@babel/template";
import traverse from "@babel/traverse";

function maybeTerminalWrap(state, terminal, ast) {
  if (terminal) {
    return template(`DATASPACE.currentFacet().stop(() => { AST })`)({
      DATASPACE: state.DataspaceID,
      AST: ast
    });
  } else {
    return ast;
  }
}

function isCaptureIdentifier(node) {
  return t.isIdentifier(node) && (node.name[0] === '$') && (node.name.length > 1);
}

function hasCapturesOrDiscards(nodePath) {
  var result = false;
  nodePath.traverse({
    enter(path) {
      if (isCaptureIdentifier(path.node)) {
        result = true;
        path.stop();
      } else if (t.isIdentifier(path.node) && (path.node.name === '_')) {
        result = true;
        path.stop();
      }
    }
  });
  return result;
}

const _discardAst = template.expression(`DATASPACE.__`, { placeholderPattern: /^[A-Z]+$/ });
function discardAst(state) {
  return _discardAst({ DATASPACE: state.DataspaceID });
}

const _listAst = template.expression(`IMMUTABLE.List(VS)`);
function listAst(state, vs) {
  return _listAst({ IMMUTABLE: state.ImmutableID, VS: vs });
}

function captureWrap(state, idNode, ast) {
  return template.expression(`SYNDICATE._$(NAME, PATTERN)`, { placeholderPattern: /^[A-Z]+$/ })({
    SYNDICATE: state.SyndicateID,
    NAME: t.stringLiteral(idNode.name.slice(1)),
    PATTERN: ast
  });
}

function astifySyndicatePath(state, a) {
  if (typeof a === 'number') {
    return t.numericLiteral(a);
  } else if (Array.isArray(a)) {
    return listAst(state, t.arrayExpression(a.map((aa) => astifySyndicatePath(state, aa))));
  } else {
    throw new Error("Cannot astify ostensible Syndicate path: " + a);
  }
}

function compilePattern(state, patternPath) {
  let constPaths = [];
  let constVals = [];
  let capturePaths = [];
  let captureNames = [];
  let syndicatePath = [];

  function pushCapture(idNode) {
    capturePaths.push(syndicatePath.slice());
    captureNames.push(idNode.name.slice(1));
  }

  function pushConstant(node) {
    constPaths.push(syndicatePath.slice());
    constVals.push(node);
  }

  function walk(patternPath) {
    let pattern = patternPath.node;
    switch (pattern.type) {
      case 'CallExpression':
        if (isCaptureIdentifier(pattern.callee) && (pattern.arguments.length === 1)) {
          // It's a capture with a nested subpattern.
          pushCapture(pattern.callee);
          let [s, a] = walk(patternPath.get('arguments.0'));
          return [s, captureWrap(state, pattern.callee, a)];
        } else {
          // It's a regular call. If there are nested captures or
          // discards, this indicates the programmer believes it to be
          // a constructor, in which case it should contribute to the
          // skeleton, otherwise the programmer believes it to be a
          // constant, in which case it should contribute to
          // constPaths/constVals.
          if (hasCapturesOrDiscards(patternPath)) {
            let arity = pattern.arguments.length;
            let skel = [t.memberExpression(pattern.callee, t.identifier('meta'), false, false)];
            let assn = [];
            for (let i = 0; i < arity; i++) {
              syndicatePath.push(i);
              let [s, a] = walk(patternPath.get('arguments.' + i));
              skel.push(s);
              assn.push(a);
              syndicatePath.pop();
            }
            return [t.arrayExpression(skel), t.callExpression(pattern.callee, assn)];
          } else {
            pushConstant(pattern);
            return [t.nullLiteral(), pattern];
          }
        }

      case 'Identifier':
        if (pattern.name === '_') {
          // do nothing -- this is a discard
          return [t.nullLiteral(), discardAst(state)];
        } else if (isCaptureIdentifier(pattern)) {
          pushCapture(pattern);
          return [t.nullLiteral(), captureWrap(state, pattern, discardAst(state))];
        } else {
          pushConstant(pattern);
          return [t.nullLiteral(), pattern];
        }

      default:
        console.error('Unsupported pattern node type', pattern);
        pushConstant(pattern);
        return [t.nullLiteral(), pattern];
    }
  }

  let [skeleton, assertion] = walk(patternPath);

  return {
    skeletonAst: skeleton,
    constPathsAst: astifySyndicatePath(state, constPaths),
    constValsAst: listAst(state, t.arrayExpression(constVals)),
    capturePathsAst: astifySyndicatePath(state, capturePaths),
    captureNames: captureNames,
    assertionAst: template.expression(`SYNDICATE.Observe(ASSERTION)`)({
      SYNDICATE: state.SyndicateID,
      ASSERTION: assertion
    }),
  };
}

function translateEndpoint(state, path, expectedEvt) {
  const { node } = path;
  let info = compilePattern(state, path.get('pattern'));
  let _evt = path.scope.generateUidIdentifier("evt");
  let _vs = path.scope.generateUidIdentifier("vs");
  path.replaceWith(template(
    `DATASPACE.currentFacet().addEndpoint(function () {
       let HANDLER = {
         skeleton: SKELETON,
         constPaths: CONSTPATHS,
         constVals: CONSTVALS,
         capturePaths: CAPTUREPATHS,
         callback: DATASPACE.wrap((EVT, VS) => {
           if (EVT === EXPECTED) {
             INITS;
             DATASPACE.currentFacet().actor.scheduleScript(() => {
               BODY;
             });
           }
         })
       };
       return [ASSERTION, HANDLER];
     });`)({
       DATASPACE: state.DataspaceID,
       HANDLER: path.scope.generateUidIdentifier("handler"),
       SKELETON: info.skeletonAst,
       CONSTPATHS: info.constPathsAst,
       CONSTVALS: info.constValsAst,
       CAPTUREPATHS: info.capturePathsAst,
       EVT: _evt,
       EXPECTED: expectedEvt,
       VS: _vs,
       INITS: info.captureNames.map((n, i) => template(`let N = VS.get(I);`)({
         N: t.identifier(n),
         VS: _vs,
         I: t.numericLiteral(i),
       })),
       BODY: maybeTerminalWrap(state, node.terminal, node.body),
       ASSERTION: info.assertionAst,
     }));
}

export default declare((api, options) => {
  api.assertVersion(7);

  return {
    manipulateOptions(opts, parserOpts) {
      parserOpts.plugins.push("syndicate");
    },

    visitor: {
      Program(path, state) {
        state.ImmutableID = path.scope.generateUidIdentifier("Immutable");
        state.SyndicateID = path.scope.generateUidIdentifier("Syndicate");
        state.DataspaceID = path.scope.generateUidIdentifier("Dataspace");
        state.SkeletonID = path.scope.generateUidIdentifier("Skeleton");
        state.StructID = path.scope.generateUidIdentifier("Struct");
        path.unshiftContainer(
          'body',
          template(`const SYNDICATE = require("@syndicate-lang/core");
                    const IMMUTABLE = SYNDICATE.Immutable;
                    const DATASPACE = SYNDICATE.Dataspace;
                    const SKELETON = SYNDICATE.Skeleton;
                    const STRUCT = SYNDICATE.Struct;`)({
                      IMMUTABLE: state.ImmutableID,
                      SYNDICATE: state.SyndicateID,
                      DATASPACE: state.DataspaceID,
                      SKELETON: state.SkeletonID,
                      STRUCT: state.StructID,
                    }));
      },

      SpawnStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(`DATASPACE.spawn(NAME, function () { BODY })`)({
          DATASPACE: state.DataspaceID,
          NAME: node.name || t.nullLiteral(),
          BODY: node.body
        }));
      },

      DataspaceStatement(path, state) {
        const { node } = path;
        let uid = path.scope.generateUidIdentifier("ds");
        // TODO: name! Also this is a ground DS not a nested one. FIXME
        path.replaceWith(template(`{ let DS = new DATASPACE(function () { BODY });
                                     while (DS.runScripts()) ; }`)({
                                       DS: uid,
                                       DATASPACE: state.DataspaceID,
                                       // NAME: node.name || t.nullLiteral(),
                                       BODY: node.body
                                     }));
      },

      FieldDeclarationStatement(path, state) {
        const { node } = path;
        let prop = node.member.computed
            ? node.member.property
            : t.stringLiteral(node.member.property.name);
        path.replaceWith(template(`DATASPACE.declareField(HOLDER, PROP, INIT);`)({
          DATASPACE: state.DataspaceID,
          HOLDER: node.member.object,
          PROP: prop,
          INIT: node.init || path.scope.buildUndefinedNode()
        }));
      },

      AssertionEndpointStatement(path, state) {
        const { node } = path;
        if (node.test) {
          path.replaceWith(template(`DATASPACE.currentFacet().addEndpoint(function () {
                                       return (TEST) ? [TEMPLATE, null] : [void 0, null];
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       TEST: node.test,
                                       TEMPLATE: node.template,
                                     }));
        } else {
          path.replaceWith(template(`DATASPACE.currentFacet().addEndpoint(function () {
                                       return [TEMPLATE, null];
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       TEMPLATE: node.template,
                                     }));
        }
      },

      DataflowStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(`DATASPACE.currentFacet().addDataflow(function () { BODY });`)({
          DATASPACE: state.DataspaceID,
          BODY: node.body,
        }));
      },

      EventHandlerEndpoint(path, state) {
        const { node } = path;
        switch (node.triggerType) {
          case "dataflow":
            path.replaceWith(template(`DATASPACE.currentFacet().addDataflow(function () {
                                         if (PATTERN) { BODY }
                                       });`)({
                                         DATASPACE: state.DataspaceID,
                                         PATTERN: node.pattern,
                                         BODY: maybeTerminalWrap(state, node.terminal, node.body),
                                       }));
            break;

          case "asserted":
            translateEndpoint(state, path, state.SkeletonID.name + ".EVENT_ADDED");
            break;
          case "retracted":
            translateEndpoint(state, path, state.SkeletonID.name + ".EVENT_REMOVED");
            break;
          case "message":
            translateEndpoint(state, path, state.SkeletonID.name + ".EVENT_MESSAGE");
            break;

          default:
            console.warn("UNHANDLED event handler endpoint triggerType " + node.triggerType);
            break;
        }
      },

      PseudoEventHandler(path, state) {
        const { node } = path;
        if (node.triggerType === "start") {
          path.replaceWith(template(`DATASPACE.currentFacet().actor.scheduleScript(() => {
                                       BODY;
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       BODY: node.body,
                                     }));
        } else {
          path.replaceWith(template(`DATASPACE.currentFacet().addStopScript(function () {
                                       BODY;
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       BODY: node.body,
                                     }));
        }
      },

      SyndicateTypeDefinition(path, state) {
        const { node } = path;
        path.replaceWith(template(`const ID = STRUCT.makeConstructor(WIRE, FORMALS);`)({
          ID: node.id,
          STRUCT: state.StructID,
          WIRE: node.wireName || t.stringLiteral(node.id.name),
          FORMALS: t.arrayExpression(node.formals.map((f) => t.stringLiteral(f.name))),
        }));
      },

      MessageSendStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(`DATASPACE.send(BODY);`)({
          DATASPACE: state.DataspaceID,
          BODY: node.body
        }));
      },
    },
  };
});
