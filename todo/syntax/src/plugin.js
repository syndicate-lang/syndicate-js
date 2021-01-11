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
import { cloneDeep, isLiteral } from "@babel/types";
import template from "@babel/template";
import traverse from "@babel/traverse";
import builder from "@babel/types/lib/builders/builder";

import generate from "@babel/generator";
function _GEN(x) { console.log(generate(x).code); }

function syndicateTemplate(str) {
  return template(str, { plugins: [ "syndicate" ] });
}

function maybeTerminalWrap(state, terminal, ast) {
  if (terminal) {
    return template(`DATASPACE._currentFacet.stop(() => { AST })`)({
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

const _discardAst = template.expression(`SYNDICATE.Discard._instance`);
function discardAst(state) {
  return _discardAst({ SYNDICATE: state.SyndicateID });
}

const _listAst = template.expression(`SYNDICATE.fromJS(VS)`);
function listAst(state, vs) {
  return _listAst({ SYNDICATE: state.SyndicateID, VS: vs });
}

function captureWrap(state, ast) {
  return template.expression(`SYNDICATE.Capture(PATTERN)`)({
    SYNDICATE: state.SyndicateID,
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
  let constTemps = [];
  let constVals = [];
  let capturePaths = [];
  let captureIds = [];
  let syndicatePath = [];

  function pushCapture(idNode) {
    capturePaths.push(syndicatePath.slice());
    captureIds.push(t.identifier(idNode.name.slice(1)));
  }

  function pushConstant(node) {
    constPaths.push(syndicatePath.slice());
    const id = patternPath.scope.generateUidIdentifier('c' + constTemps.length);
    constTemps.push([id, node]);
    constVals.push(id);
    return id;
  }

  function walk(patternPath) {
    let pattern = patternPath.node;
    switch (pattern.type) {
      case 'CallExpression':
        if (isCaptureIdentifier(pattern.callee) && (pattern.arguments.length === 1)) {
          // It's a capture with a nested subpattern.
          pushCapture(pattern.callee);
          let [s, a] = walk(patternPath.get('arguments.0'));
          return [s, captureWrap(state, a)];
        } else {
          // It's a regular call. If there are nested captures or
          // discards, this indicates the programmer believes it to be
          // a constructor, in which case it should contribute to the
          // skeleton, otherwise the programmer believes it to be a
          // constant, in which case it should contribute to
          // constPaths/constVals.
          if (hasCapturesOrDiscards(patternPath)) {
            let arity = pattern.arguments.length;
            let skel = [t.memberExpression(pattern.callee, t.identifier('constructorInfo'), false, false)];
            let assn = [];
            for (let i = 0; i < arity; i++) {
              syndicatePath.push(i);
              let [s, a] = walk(patternPath.get('arguments.' + i));
              skel.push(s);
              assn.push(a);
              syndicatePath.pop();
            }
            return [t.arrayExpression(skel), t.callExpression(cloneDeep(pattern.callee), assn)];
          } else {
            return [t.nullLiteral(), pushConstant(pattern)];
          }
        }

      case 'Identifier':
        if (pattern.name === '_') {
          // do nothing -- this is a discard
          return [t.nullLiteral(), discardAst(state)];
        } else if (isCaptureIdentifier(pattern)) {
          pushCapture(pattern);
          return [t.nullLiteral(), captureWrap(state, discardAst(state))];
        } else {
          return [t.nullLiteral(), pushConstant(pattern)];
        }

      case 'ArrayExpression': {
        if (hasCapturesOrDiscards(patternPath)) {
          let arity = pattern.elements.length;
          let skel = [t.numericLiteral(arity)];
          let assn = [];
          for (let i = 0; i < arity; i++) {
            syndicatePath.push(i);
            let [s, a] = walk(patternPath.get('elements.' + i));
            skel.push(s);
            assn.push(a);
            syndicatePath.pop();
          }
          return [t.arrayExpression(skel), t.arrayExpression(assn)];
        } else {
          return [t.nullLiteral(), pushConstant(pattern)];
        }
      }

      default:
        if (!isLiteral(pattern)) {
          console.error('Unsupported pattern node type', pattern);
        }
        // FALL THROUGH
      case 'BinaryExpression':
      case 'MemberExpression':
        return [t.nullLiteral(), pushConstant(pattern)];
    }
  }

  let [skeleton, assertion] = walk(patternPath);

  return {
    skeletonAst: skeleton,
    constPathsAst: astifySyndicatePath(state, constPaths),
    constTemps: constTemps,
    constValsAst: listAst(state, t.arrayExpression(constVals)),
    capturePathsAst: astifySyndicatePath(state, capturePaths),
    captureIds: captureIds,
    assertionAst: template.expression(`SYNDICATE.Observe(ASSERTION)`)({
      SYNDICATE: state.SyndicateID,
      ASSERTION: assertion
    }),
  };
}

function instantiatePatternToPattern(state, patternPath) {

  function visitCallExpression(path) {
    if (!isCaptureIdentifier(path.node.callee)) return true;
    path.replaceWith(t.identifier(path.node.callee.name.slice(1)));
    path.skip();
    return false;
  }
  function visitIdentifier(path) {
    if (!isCaptureIdentifier(path.node)) return true;
    path.replaceWith(t.identifier(path.node.name.slice(1)));
    path.skip();
    return false;
  }

  patternPath.node = cloneDeep(patternPath.node);
  // OK I must have misunderstood something, because could it really
  // be the case that traverse recursively visits all the CHILDREN of
  // the given node but NOT THE GIVEN NODE ITSELF???
  let doTraverse = true;
  if (doTraverse && (patternPath.node.type === 'CallExpression')) {
    doTraverse = visitCallExpression(patternPath);
  }
  if (doTraverse && (patternPath.node.type === 'Identifier')) {
    doTraverse = visitIdentifier(patternPath);
  }
  if (doTraverse) {
    patternPath.traverse({
      CallExpression(path) { visitCallExpression(path) },
      Identifier(path) { visitIdentifier(path) },
    });
  }
  return patternPath.node;
}

const bindingRegistrationVisitor = {
  EventHandlerEndpoint(path, state) {
    if (Array.isArray(path.node.captureIds)) return;
    switch (path.node.triggerType) {
      case "dataflow":
        break;
      case "asserted":
      case "retracted":
      case "message": {
        let info = compilePattern(state, path.get('pattern'));
        path.node.captureIds = info.captureIds;
        path.scope.registerBinding('let', path);
        break;
      }
    }
  },

  DuringStatement(path, state) {
    if (Array.isArray(path.node.captureIds)) return;
    let info = compilePattern(state, path.get('pattern'));
    path.node.captureIds = info.captureIds;
    path.scope.registerBinding('let', path);
  },
};

function translateEndpoint(state, path, expectedEvt) {
  const { node } = path;
  let info = compilePattern(state, path.get('pattern'));
  let _assn = path.scope.generateUidIdentifier("assn");
  let _evt = path.scope.generateUidIdentifier("evt");
  let _vs = path.scope.generateUidIdentifier("vs");

  path.replaceWith(template(
    `DATASPACE._currentFacet.addEndpoint(function () {
       CONSTTEMPS;
       const ASSN = ASSERTION;
       let HANDLER = {
         skeleton: SKELETON,
         constPaths: CONSTPATHS,
         constVals: CONSTVALS,
         capturePaths: CAPTUREPATHS,
         assertion: ASSN,
         callback: DATASPACE.wrap((EVT, VS) => {
           if (EVT === EXPECTED) {
             INITS;
             DATASPACE._currentFacet.actor.scheduleScript(() => {
               BODY;
             });
           }
         })
       };
       return [ASSN, HANDLER];
     }, ISDYNAMIC);`)({
       DATASPACE: state.DataspaceID,
       HANDLER: path.scope.generateUidIdentifier("handler"),
       SKELETON: info.skeletonAst,
       CONSTPATHS: info.constPathsAst,
       CONSTTEMPS: info.constTemps.map(([n,i]) => template(`const N = I;`)({N:n, I:i})),
       ASSN: _assn,
       ASSERTION: info.assertionAst,
       CONSTVALS: info.constValsAst,
       CAPTUREPATHS: info.capturePathsAst,
       EVT: _evt,
       EXPECTED: expectedEvt,
       VS: _vs,
       INITS: info.captureIds.map((n, i) => template(`let N = VS.get(I);`)({
         N: n,
         VS: _vs,
         I: t.numericLiteral(i),
       })),
       BODY: maybeTerminalWrap(state, node.terminal, node.body),
       ISDYNAMIC: t.booleanLiteral(node.isDynamic),
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
        let savedGlobalFacetUid = path.scope.generateUidIdentifier("savedGlobalFacet");
        state.SyndicateID = path.scope.generateUidIdentifier("Syndicate");
        state.DataspaceID = path.scope.generateUidIdentifier("Dataspace");
        state.SkeletonID = path.scope.generateUidIdentifier("Skeleton");
        state.RecordID = path.scope.generateUidIdentifier("Record");
        path.unshiftContainer(
          'body',
          template(`const SYNDICATE = require("@syndicate-lang/core");
                    const DATASPACE = SYNDICATE.Dataspace;
                    const SKELETON = SYNDICATE.Skeleton;
                    const RECORD = SYNDICATE.Record;
                    let SAVEDGLOBALFACET = DATASPACE._currentFacet;
                    DATASPACE._currentFacet = new SYNDICATE._Dataspace.ActionCollector();`)({
                      SYNDICATE: state.SyndicateID,
                      DATASPACE: state.DataspaceID,
                      SKELETON: state.SkeletonID,
                      RECORD: state.RecordID,
                      SAVEDGLOBALFACET: savedGlobalFacetUid,
                    }));
        path.pushContainer(
          'body',
          template(`module.exports[DATASPACE.BootSteps] = {
                      module: module,
                      steps: DATASPACE._currentFacet.actions
                    };
                    DATASPACE._currentFacet = SAVEDGLOBALFACET;
                    SAVEDGLOBALFACET = null;
                    if ((typeof require === 'undefined' ? {main: void 0} : require).main === module) {
                      SYNDICATE.bootModule(module);
                    }`)({
                      DATASPACE: state.DataspaceID,
                      SYNDICATE: state.SyndicateID,
                      SAVEDGLOBALFACET: savedGlobalFacetUid,
                    }));

        path.traverse(bindingRegistrationVisitor, state);
      },

      SpawnStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(`DATASPACE.spawn(NAME, PROC, ASSERTIONS)`)({
          DATASPACE: state.DataspaceID,
          NAME: node.name || t.nullLiteral(),
          PROC: !node.isDataspace ? node.bootProc : template.expression(
            `SYNDICATE.inNestedDataspace(PROC)`)({
              SYNDICATE: state.SyndicateID,
              PROC: node.bootProc
            }),
          ASSERTIONS: node.initialAssertions.length === 0 ? null :
            template.expression(`SYNDICATE.Set(SEQ)`)({
              SYNDICATE: state.SyndicateID,
              SEQ: t.arrayExpression(node.initialAssertions)
            }),
        }));
        if (node.parentIds.length > 0) {
          const stmts = [];
          for (let i = 0; i < node.parentIds.length; i++) {
            const id = node.parentIds[i];
            const init = node.parentInits[i];
            stmts.push(template(`const ID = INIT;`)({ ID: id, INIT: init }));
          }
          stmts.push(path.node);
          path.replaceWith(t.blockStatement(stmts, []));
        }
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
          path.replaceWith(template(`DATASPACE._currentFacet.addEndpoint(function () {
                                       return (TEST) ? [TEMPLATE, null] : [void 0, null];
                                     }, ISDYNAMIC);`)({
                                       DATASPACE: state.DataspaceID,
                                       TEST: node.test,
                                       TEMPLATE: node.template,
                                       ISDYNAMIC: t.booleanLiteral(node.isDynamic),
                                     }));
        } else {
          path.replaceWith(template(`DATASPACE._currentFacet.addEndpoint(function () {
                                       return [TEMPLATE, null];
                                     }, ISDYNAMIC);`)({
                                       DATASPACE: state.DataspaceID,
                                       TEMPLATE: node.template,
                                       ISDYNAMIC: t.booleanLiteral(node.isDynamic),
                                     }));
        }
      },

      DataflowStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(`DATASPACE._currentFacet.addDataflow(function () { BODY });`)({
          DATASPACE: state.DataspaceID,
          BODY: node.body,
        }));
      },

      EventHandlerEndpoint(path, state) {
        const { node } = path;
        switch (node.triggerType) {
          case "dataflow":
            path.replaceWith(syndicateTemplate(`dataflow { if (PATTERN) { BODY } }`)({
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
          path.replaceWith(template(`DATASPACE._currentFacet.addStartScript(() => {
                                       BODY;
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       BODY: node.body,
                                     }));
        } else {
          path.replaceWith(template(`DATASPACE._currentFacet.addStopScript(function () {
                                       BODY;
                                     });`)({
                                       DATASPACE: state.DataspaceID,
                                       BODY: node.body,
                                     }));
        }
      },

      SyndicateTypeDefinition(path, state) {
        const { node } = path;
        path.replaceWith(template(`const ID = RECORD.makeBasicConstructor(WIRE, FORMALS);`)({
          ID: node.id,
          RECORD: state.RecordID,
          WIRE: node.wireName ||
            template.expression(`Symbol.for(N)`)({N: t.stringLiteral(node.id.name)}),
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

      ActivationExpression(path, state) {
        const { node } = path;
        path.replaceWith(template.expression(`DATASPACE.activate(MODULE)`)({
          DATASPACE: state.DataspaceID,
          MODULE: node.moduleExpr,
        }));
      },

      DuringStatement(path, state) {
        const { node } = path;
        if (node.body.type === "SpawnStatement") {
          let idId = path.scope.generateUidIdentifier("id");
          let instId = path.scope.generateUidIdentifier("inst");
          let bodyPath = path.get('body');
          bodyPath.unshiftContainer('initialAssertions', [
            template.expression(`I`)({
              I: instId
            }),
            template.expression(`S.Observe(S.Observe(I))`)({
              S: state.SyndicateID,
              I: instId
            }),
          ]);
          bodyPath.get('bootProc.body').replaceWithMultiple([
            syndicateTemplate(`assert I;`)({
              I: instId
            }),
            syndicateTemplate(`stop on retracted S.Observe(I);`)({
              S: state.SyndicateID,
              I: instId
            }),
            node.body.bootProc.body,
          ]);
          path.replaceWith(syndicateTemplate(
            `on asserted PATTERN1 {
               let IDID = SYNDICATE.genUuid();
               let INSTID = SYNDICATE.Instance(IDID);
               react {
                 stop on asserted INSTID react {
                   stop on retracted INSTID;
                   stop on retracted :snapshot PATTERN2;
                 }
                 stop on retracted :snapshot PATTERN2 react {
                   stop on asserted INSTID;
                 }
               }
               BODY
             }`)({
               PATTERN1: node.pattern,
               PATTERN2: instantiatePatternToPattern(state, path.get('pattern')),
               BODY: node.body,
               SYNDICATE: state.SyndicateID,
               IDID: idId,
               INSTID: instId,
             }));
        } else {
          // TODO: this is a hopefully-temporary performance hack. Ideally we'd expand to
          // something like we had earlier, namely
          //
          // on asserted PATTERN1 react {
          //   stop on retracted :snapshot PATTERN2
          //   BODY
          // }
          //
          // but for now, in order to avoid subscription churn, we use PATTERN1's retracted
          // events to manage the lifetimes of the nested react.

          const info = compilePattern(state, path.get('pattern'));
          path.replaceWith(syndicateTemplate(
            `{
              let FACETS = SYNDICATE.Map();
              on asserted PATTERN react {
                FACETS = FACETS.set(KEY, DATASPACE._currentFacet);
                dataflow void 0; // TODO: horrible hack to keep the facet alive if no other endpoints
                BODY
              }
              on retracted PATTERN {
                let KEYID = KEY;
                FACETS.get(KEYID).stop();
                FACETS = FACETS.remove(KEYID);
              }
            }`)({
              FACETS: path.scope.generateUidIdentifier("facets"),
              SYNDICATE: state.SyndicateID,
              PATTERN: node.pattern,
              KEY: listAst(state, t.arrayExpression(info.captureIds)),
              DATASPACE: state.DataspaceID,
              BODY: node.body,
              KEYID: path.scope.generateUidIdentifier("key"),
            }));
        }
        path.parentPath.traverse(bindingRegistrationVisitor, state);
      },

      SyndicateReactStatement(path, state) {
        const { node } = path;
        path.replaceWith(template(
          `DATASPACE._currentFacet.actor.addFacet(
             DATASPACE._currentFacet,
             BODYPROC,
             true);`)({
               DATASPACE: state.DataspaceID,
               BODYPROC: node.bodyProc,
             }));
      },
    },
  };
});
