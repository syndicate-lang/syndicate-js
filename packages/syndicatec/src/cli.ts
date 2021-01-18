import yargs from 'yargs/yargs';
import { Argv } from 'yargs';

import fs from 'fs';
import { compile } from '@syndicate-lang/compiler';

export type ModuleChoice = 'es6' | 'require' | 'global';
const moduleChoices: ReadonlyArray<ModuleChoice> = ['es6', 'require', 'global'];

export type CommandLineArguments = {
    input: string | undefined;
    output: string | undefined;
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

export function main(argv: string[]) {
    const options: CommandLineArguments = checkModuleChoice(yargs(argv)
        .command('$0 [input]',
                 'Compile a single file',
                 yargs => yargs
                     .positional('input', {
                         type: 'string',
                         description: 'Input filename',
                     })
                     .option('output', {
                         alias: 'o',
                         type: 'string',
                         description: 'Output filename (stdout if omitted)',
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

    const inputFilename = options.input ?? '/dev/stdin';
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

    if (options.output !== void 0) {
        if (!options.map) {
            fs.writeFileSync(options.output, text);
        } else if (options.mapExtension) {
            const mapFilename = options.output + options.mapExtension;
            fs.writeFileSync(options.output, text + `\n//# sourceMappingURL=${mapFilename}`);
            fs.writeFileSync(mapFilename, JSON.stringify(map));
        } else {
            fs.writeFileSync(options.output, text + `\n//# sourceMappingURL=${mapDataURL()}`);
        }
    } else {
        if (!options.map) {
            console.log(text);
        } else {
            console.log(text + `\n//# sourceMappingURL=${mapDataURL()}`);
        }
    }
}
