import yargs from 'yargs/yargs';
import { Argv } from 'yargs';

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

import { compile } from '@syndicate-lang/compiler';

export type ModuleChoice = 'es6' | 'require' | 'global';
const moduleChoices: ReadonlyArray<ModuleChoice> = ['es6', 'require', 'global'];

export type CommandLineArguments = {
    input: string | undefined;
    outputDirectory?: string | undefined;
    rootDirectory?: string;
    rename: string | undefined;
    map: boolean;
    mapExtension?: string;
    runtime: string;
    module: ModuleChoice;
}

function checkModuleChoice<T>(t: T & { module: string }): T & { module: ModuleChoice } {
    const mc = t.module as ModuleChoice;
    if (moduleChoices.indexOf(mc) !== -1) return { ... t, module: mc };
    throw new Error("Illegal --module argument: " + t.module);
}

function makeRenamer(outputDir: string,
                     rootDir: string,
                     renamePattern: string | undefined): (f: string) => string
{
    const rewrites: Array<(f: string) => (string | null)> =
        (renamePattern === void 0 ? [] : renamePattern.split(/,/)).map(p => {
            const [ from, to ] = p.split(/:/);
            let mFrom = /([^%]*)%([^%]*)/.exec(from);
            let mTo = /([^%]*)%([^%]*)/.exec(to);
            if (mFrom === null && mTo === null) {
                return f => (f === from) ? to : null;
            } else if (mFrom === null || mTo === null) {
                throw new Error(`Invalid --rename pattern: ${JSON.stringify(p)}`);
            } else {
                const [fh, ft] = mFrom.slice(1);
                const [th, tt] = mTo.slice(1);
                return f =>
                    (f.startsWith(fh) && f.endsWith(ft))
                    ? th + f.substring(fh.length, f.length - ft.length) + tt
                    : null;
            }
        });
    const relocate = (f: string) => path.join(outputDir, path.relative(rootDir, f));
    return f => {
        for (const rewrite of rewrites) {
            const t = rewrite(f);
            if (t !== null) return relocate(t);
        }
        return relocate(f);
    };
}

export function main(argv: string[]) {
    const options: CommandLineArguments = checkModuleChoice(yargs(argv)
        .command('$0 [input]',
                 'Compile away Syndicate extensions',
                 yargs => yargs
                     .positional('input', {
                         type: 'string',
                         description: 'Input filename or glob (stdin if omitted)',
                     })
                     .option('root-directory', {
                         alias: 'b',
                         type: 'string',
                         description: 'Root directory for input files',
                         default: '.',
                     })
                     .option('output-directory', {
                         alias: 'd',
                         type: 'string',
                         description: 'Output directory (if omitted: stdout if stdin as input, else cwd)',
                     })
                     .option('rename', {
                         type: 'string',
                         description: 'Rewrite input filenames',
                         default: '%.syndicate.js:%.js,%.syndicate.ts:%.ts',
                     })
                     .option('map', {
                         type: 'boolean',
                         description: 'Generate source maps',
                         default: true,
                     })
                     .option('map-extension', {
                         type: 'string',
                         description: 'Extension (e.g. ".map") to add to source map files; if omitted, source maps are generated inline',
                     })
                     .option('runtime', {
                         type: 'string',
                         description: 'Path to require or import to get the Syndicate runtime',
                         default: '@syndicate-lang/core',
                     })
                     .option('module', {
                         choices: moduleChoices,
                         type: 'string',
                         description: 'Style of import/export definition to prefer',
                         default: moduleChoices[0],
                     }),
                 argv => argv)
        .argv);

    const rename = makeRenamer(options.outputDirectory ?? '',
                               options.rootDirectory ?? '.',
                               options.rename);

    const STDIN = '/dev/stdin';

    const inputGlob = options.input ?? STDIN;
    const inputFilenames = glob.sync(inputGlob);

    for (const inputFilename of inputFilenames) {
        const outputFilename =
            (inputFilename === STDIN) ? '/dev/stdout' :
            (inputFilename[0] === '/') ? (() => { throw new Error("Absolute input paths are not supported"); })() :
            rename(inputFilename);

        if (inputFilenames.indexOf(outputFilename) !== -1) {
            throw new Error(`Output from ${JSON.stringify(inputFilename)} would trample on existing input file ${JSON.stringify(outputFilename)}`);
        }

        const source = fs.readFileSync(inputFilename, 'utf-8');

        const { text, map } = compile({
            source,
            name: inputFilename,
            runtime: options.runtime,
            module: options.module,
        });
        map.sourcesContent = [source];

        function mapDataURL() {
            const mapData = Buffer.from(JSON.stringify(map)).toString('base64')
            return `data:application/json;base64,${mapData}`;
        }

        if (inputFilename !== STDIN) {
            fs.mkdirSync(path.dirname(outputFilename), { recursive: true });
        }

        if (!options.map) {
            fs.writeFileSync(outputFilename, text);
        } else if (options.mapExtension && inputFilename !== STDIN) {
            const mapFilename = outputFilename + options.mapExtension;
            fs.writeFileSync(outputFilename, text + `\n//# sourceMappingURL=${mapFilename}`);
            fs.writeFileSync(mapFilename, JSON.stringify(map));
        } else {
            fs.writeFileSync(outputFilename, text + `\n//# sourceMappingURL=${mapDataURL()}`);
        }
    }
}
