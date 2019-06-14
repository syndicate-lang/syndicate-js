"use strict";
//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
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

// Property-based "dataflow"

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                require('path').basename(module.filename),
                                                module)) return;

var Immutable = require("immutable");
var MapSet = require("./mapset.js");

function Graph() {
  this.edgesForward = Immutable.Map();
  this.edgesReverse = Immutable.Map();
  this.damagedNodes = Immutable.Set();
  this.currentSubjectId = null;
}

Graph.prototype.withSubject = function (subjectId, f) {
  var oldSubjectId = this.currentSubjectId;
  this.currentSubjectId = subjectId;
  var result;
  try {
    result = f();
  } catch (e) {
    this.currentSubjectId = oldSubjectId;
    throw e;
  }
  this.currentSubjectId = oldSubjectId;
  return result;
};

Graph.prototype.recordObservation = function (objectId) {
  if (this.currentSubjectId) {
    this.edgesForward = MapSet.add(this.edgesForward, objectId, this.currentSubjectId);
    this.edgesReverse = MapSet.add(this.edgesReverse, this.currentSubjectId, objectId);
  }
};

Graph.prototype.recordDamage = function (objectId) {
  this.damagedNodes = this.damagedNodes.add(objectId);
};

Graph.prototype.forgetSubject = function (subjectId) {
  var self = this;
  var subjectObjects = self.edgesReverse.get(subjectId) || Immutable.Set();
  self.edgesReverse = self.edgesReverse.remove(subjectId);
  subjectObjects.forEach(function (objectId) {
    self.edgesForward = MapSet.remove(self.edgesForward, objectId, subjectId);
  });
};

Graph.prototype.repairDamage = function (repairNode) {
  var self = this;
  var repairedThisRound = Immutable.Set();
  while (true) {
    var workSet = self.damagedNodes;
    self.damagedNodes = Immutable.Set();

    var alreadyDamaged = workSet.intersect(repairedThisRound);
    if (!alreadyDamaged.isEmpty()) {
      console.warn('Cyclic dependencies involving', alreadyDamaged);
    }

    workSet = workSet.subtract(repairedThisRound);
    repairedThisRound = repairedThisRound.union(workSet);

    if (workSet.isEmpty()) break;

    workSet.forEach(function (objectId) {
      var subjects = self.edgesForward.get(objectId) || Immutable.Set();
      subjects.forEach(function (subjectId) {
        self.forgetSubject(subjectId);
        self.withSubject(subjectId, function () {
          repairNode(subjectId);
        });
      });
    });
  }
};

Graph.prototype.defineObservableProperty = function (obj, prop, value, maybeOptions) {
  var graph = this;
  var options = maybeOptions === void 0 ? {} : maybeOptions;
  var objectId = options.objectId || '__' + prop;
  Object.defineProperty(obj, prop, {
    configurable: true,
    enumerable: true,
    get: function () {
      graph.recordObservation(objectId);
      return value;
    },
    set: function (newValue) {
      if (!options.noopGuard || !options.noopGuard(value, newValue)) {
        graph.recordDamage(objectId);
        value = newValue;
      }
    }
  });
  graph.recordDamage(objectId);
  return objectId;
};

Graph.newScope = function (o) {
  function O() {}
  O.prototype = o;
  return new O();
};

///////////////////////////////////////////////////////////////////////////

module.exports.Graph = Graph;
