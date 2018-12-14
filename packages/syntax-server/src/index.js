"use strict";

import { Bytes, spawnWorker } from "@syndicate-lang/core";
const Http = activate require("@syndicate-lang/driver-http-node");
const S = activate require("@syndicate-lang/driver-streams-node");
const C = require("./compiler");
const J = activate require("./job");

const fs = require('fs');

const options = {
  "port": 14641,
  "babel-options": JSON.parse(fs.readFileSync(__dirname + '/../.babelrc')),
};

function usage() {
  console.info('Usage: syndicate-babel-server [--port HTTPPORT] [--babelrc FILENAME]');
  console.info('                              [--babel-options JSON]');
  console.info(options);
}

function process_command_line(args) {
  while (args.length) {
    switch (args[0]) {
      case '--port': {
        args.shift();
        options.port = Number.parseInt(args.shift());
        break;
      }
      case '--babelrc': {
        args.shift();
        options["babel-options"] = JSON.parse(fs.readFileSync(args.shift()));
        break;
      }
      case '--babel-options': {
        args.shift();
        options["babel-options"] = JSON.parse(args.shift());
        break;
      }

      default:
        console.error("Unsupported command-line argument: " + args[0]);
        /* FALL THROUGH */
      case '--help':
      case '-h':
        usage();
        process.exit(1);
    }
  }
}

process_command_line(process.argv.slice(2));
console.info(`http://localhost:${options.port}/compile/FILENAME`);
console.info(options);

spawn named 'rootServer' {
  assert C.CompilationOptions(options["babel-options"]);

  const server = Http.HttpServer(null, options.port);
  during Http.Request($reqId, server, 'post', ['compile', $file], _, $reqSeal) spawn named reqId {
    stop on retracted S.Readable(reqId);
    _collectSource.call(this, reqId, (source) => {
      react {
        const job = C.Compilation(file, source);
        stop on asserted J.Job(job, J.JobError($errmsg)) {
          react assert Http.Response(
            reqId, 400, "Error", {"Content-Type": "text/plain"}, errmsg);
        }
        stop on asserted J.Job(job, J.JobResult($output)) {
          react assert Http.Response(reqId, 200, "OK", {}, output);
        }
      }
    });
  }
}

function _collectSource(streamId, cb) {
  const chunks = [];
  on message S.Data(streamId, $chunk) chunks.push(chunk);
  on asserted S.End(streamId) {
    const source = Bytes.concat(chunks).toString();
    cb(source);
  }
}

{
  const nCPUs = require('os').cpus().length;
  for (let i = 0; i < nCPUs; i++) {
    // spawn dataspace activate C;
    spawnWorker(__dirname + '/compiler.js');
  }
}
