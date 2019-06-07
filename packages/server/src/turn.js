"use strict";

import { Dataspace, _Dataspace, currentFacet } from "@syndicate-lang/core";
const PRIORITY = _Dataspace.PRIORITY;

export function recorder(fields, fieldName, callbacks) {
  function extend(item) {
    callbacks.extend(item);
    fields[fieldName] = true;
  }
  function commit() {
    if (fields[fieldName]) {
      callbacks.commit();
      fields[fieldName] = false;
    }
  }

  field fields[fieldName] = false;
  currentFacet().addDataflow(commit, PRIORITY.IDLE);
  return { extend, commit };
}

export function replayer(callbacks0) {
  const callbacks = callbacks0 || {};
  return {
    worklist: [],
    extend: function (thunk) {
      this.worklist.push(Dataspace.wrap(thunk));
    },
    commit: function () {
      this.worklist.forEach((thunk) => thunk());
      this.worklist.length = 0; // clear out the list
    }
  };
}
