"use strict";

import { Dataspace, _Dataspace, currentFacet } from "@syndicate-lang/core";
const PRIORITY = _Dataspace.PRIORITY;

export function recorder(fields, fieldName, onCommit) {
  let items = [];

  function extend(item) {
    items.push(item);
    fields[fieldName] = true;
  }
  function commit() {
    if (fields[fieldName]) {
      onCommit(items);
      items = [];
      fields[fieldName] = false;
    }
  }

  field fields[fieldName] = false;
  currentFacet().addDataflow(commit, PRIORITY.IDLE);
  return { extend, commit };
}
