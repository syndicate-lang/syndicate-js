#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv =
      yargs(hideBin(process.argv))
      .completion()
      .command('$0 [input]', 'Compile a single file', (yargs) => {
        yargs
          .positional('input', {
            type: 'string',
            description: 'Input filename',
          })
          .option('output', {
            alias: 'o',
            type: 'string',
            description: 'Output filename (stdout if omitted)',
            default: null,
          })
          .option('map', {
            type: 'boolean',
            description: 'Generate source maps',
            default: true,
          })
          .option('map-extension', {
            type: 'string',
            description: 'Extension (e.g. ".map") to add to source map files; if omitted, source maps are generated inline',
            default: null,
          })
          .option('runtime', {
            type: 'string',
            description: 'Path to require or import to get the Syndicate runtime',
            default: '@syndicate/core',
          })
          .option('module', {
            type: 'string',
            description: 'es6 | require | global',
          })
      })
      .argv;

const fs = require('fs');
const { compile } = require('../dist/syndicate.js').Compiler;

// console.log(argv);

const inputFilename = 'input' in argv ? argv.input : '/dev/stdin';
const source = fs.readFileSync(inputFilename, 'utf-8');

const { text, map } = compile({
  source,
  name: inputFilename,
  runtime: argv.runtime,
  module: argv.module,
});
map.sourcesContent = [source];

function mapDataURL() {
  const mapData = Buffer.from(JSON.stringify(map)).toString('base64')
  return `data:application/json;base64,${mapData}`;
}

if (argv.output !== null) {
  if (!argv.map) {
    fs.writeFileSync(argv.output, text);
  } else if (argv.mapExtension) {
    const mapFilename = argv.output + argv.mapExtension;
    fs.writeFileSync(argv.output, text + `\n//# sourceMappingURL=${mapFilename}`);
    fs.writeFileSync(mapFilename, JSON.stringify(map));
  } else {
    fs.writeFileSync(argv.output, text + `\n//# sourceMappingURL=${mapDataURL()}`);
  }
} else {
  if (!argv.map) {
    console.log(text);
  } else {
    console.log(text + `\n//# sourceMappingURL=${mapDataURL()}`);
  }
}
