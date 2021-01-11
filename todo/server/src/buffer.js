"use strict";

import { List } from "@syndicate-lang/core";

export function buffer(fields, fieldName) {
  field fields[fieldName] = List();
  return {
    push: function (item) {
      fields[fieldName] = fields[fieldName].push(item);
    },
    drain: function (handler) {
      dataflow {
        if (!fields[fieldName].isEmpty()) {
          fields[fieldName].forEach(handler);
          fields[fieldName] = List();
        }
      }
    }
  };
}
