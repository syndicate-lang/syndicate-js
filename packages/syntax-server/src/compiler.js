"use strict";

require("@syndicate-lang/syntax/lib/index"); // patches babel -- load before any of babel loads!!
const BabelTransform = require("@babel/core/lib/transform");

import { Observe, Dataspace, genUuid, Inbound, Outbound } from "@syndicate-lang/core";

import { WorkItem, JobResult, JobError } from "./job";
assertion type CompilationOptions(options);
assertion type Compilation(filename, input);

export {
  CompilationOptions,
  Compilation,
};

spawn named 'compiler' {
  const worker = genUuid('worker');
  during Inbound(CompilationOptions($options)) {
    during Inbound(Observe(WorkItem(worker, Compilation($filename, $input), _))) {
      const finalOptions = Object.assign({filename: '/' + filename}, options.toJS());
      console.log(worker, 'compiling', filename, '...');
      BabelTransform.transform(input, finalOptions, Dataspace.wrapExternal((err, output) => {
        react assert Outbound(WorkItem(worker,
                                       Compilation(filename, input),
                                       err ? JobError(err.toString()) : JobResult(output.code)));
      }));
    }
  }
}
