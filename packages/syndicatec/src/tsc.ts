import yargs from 'yargs/yargs';

import ts from 'typescript';
import crypto from 'crypto';

import { compile } from '@syndicate-lang/compiler';
import { SpanIndex, Token } from '@syndicate-lang/compiler/lib/syntax';

export type CommandLineArguments = {
    verbose: boolean;
};

interface SyndicateInfo {
    originalSource: string;
    languageVersion: ts.ScriptTarget;
    targetToSourceMap: SpanIndex<Token>;
    sourceToTargetMap: SpanIndex<number>;
}

const syndicateInfo: Map<string, SyndicateInfo> = new Map();

function createProgram(rootNames: readonly string[] | undefined,
                       options: ts.CompilerOptions | undefined,
                       host?: ts.CompilerHost,
                       oldProgram?: ts.EmitAndSemanticDiagnosticsBuilderProgram,
                       configFileParsingDiagnostics?: readonly ts.Diagnostic[],
                       projectReferences?: readonly ts.ProjectReference[])
: ts.EmitAndSemanticDiagnosticsBuilderProgram
{
    if (host === void 0) {
        throw new Error("CompilerHost not present - cannot continue");
    }

    if (rootNames === void 0) {
        console.warn("No Syndicate source files to compile");
    }

    const oldGetSourceFile = host.getSourceFile;

    host.getSourceFile = (fileName: string,
                          languageVersion: ts.ScriptTarget,
                          onError?: ((message: string) => void),
                          shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined => {
        if ((rootNames?.indexOf(fileName) ?? -1) !== -1) {
            try {
                const inputText = host.readFile(fileName);
                if (inputText === void 0) {
                    onError?.(`Could not read input file ${fileName}`);
                    return undefined;
                }
                const { text: expandedText, targetToSourceMap, sourceToTargetMap } = compile({
                    source: inputText,
                    name: fileName,
                    typescript: true,
                });
                syndicateInfo.set(fileName, {
                    originalSource: inputText,
                    languageVersion,
                    targetToSourceMap,
                    sourceToTargetMap,
                });
                const sf = ts.createSourceFile(fileName, expandedText, languageVersion, true);
                (sf as any).version = crypto.createHash('sha256').update(expandedText).digest('hex');
                return sf;
            } catch (e) {
                console.error(e);
                onError?.(e.message);
                return undefined;
            }
        } else {
            return oldGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
        }
    };

    return ts.createEmitAndSemanticDiagnosticsBuilderProgram(rootNames,
                                                             options,
                                                             host,
                                                             oldProgram,
                                                             configFileParsingDiagnostics,
                                                             projectReferences);
}

export function fixSourceMap(_ctx: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    return sf => {
        const fileName = sf.fileName;
        const info = syndicateInfo.get(fileName);
        if (info === void 0) throw new Error("No Syndicate info available for " + fileName);
        const targetToSourceMap = info.targetToSourceMap;
        const syndicateSource = ts.createSourceMapSource(fileName, info.originalSource);

        function adjustSourceMap(n: ts.Node) {
            const ps = targetToSourceMap.get(n.pos);
            const pe = targetToSourceMap.get(n.end);
            if (ps !== null && pe !== null) {
                ts.setSourceMapRange(n, {
                    pos: ps.firstItem.start.pos + ps.offset,
                    end: pe.lastItem.start.pos + pe.offset,
                    source: syndicateSource,
                });
            }
            ts.forEachChild(n, adjustSourceMap);
        }

        adjustSourceMap(sf);

        return sf;
    };
}

const syntheticSourceFiles = new Map<string, ts.SourceFile>();
function fixupDiagnostic(d: ts.Diagnostic) {
    if (d.file !== void 0 && d.start !== void 0) {
        const info = syndicateInfo.get(d.file.fileName);
        if (info === void 0)
            return;

        if (!syntheticSourceFiles.has(d.file.fileName)) {
            syntheticSourceFiles.set(
                d.file.fileName,
                ts.createSourceFile(d.file.fileName,
                                    info.originalSource,
                                    info.languageVersion,
                                    false,
                                    ts.ScriptKind.Unknown));
        }
        d.file = syntheticSourceFiles.get(d.file.fileName);
        const p = info.targetToSourceMap.get(d.start)!;
        d.start = p.firstItem.start.pos + p.offset;
    }
}

export function main(argv: string[]) {
    const options: CommandLineArguments = yargs(argv)
        .option('verbose', {
            type: 'boolean',
            default: false,
            description: "Enable verbose solution builder output",
        })
        .argv;

    let problemCount = 0;
    let hasErrors = false;

    const formatDiagnosticsHost: ts.FormatDiagnosticsHost = {
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getNewLine: () => ts.sys.newLine,
        getCanonicalFileName: f => f,
    };

    function reportDiagnostic(d: ts.Diagnostic) {
        if (d.category === ts.DiagnosticCategory.Error) problemCount++;
        fixupDiagnostic(d);
        console.log(ts.formatDiagnosticsWithColorAndContext([d], formatDiagnosticsHost).trimEnd());
    }

    function reportErrorSummary(n: number) {
        if (n > 0) {
            console.error(`\n - ${n} errors reported`);
            hasErrors = true;
        }
    }

    const sbh = ts.createSolutionBuilderHost(ts.sys,
                                             createProgram,
                                             reportDiagnostic,
                                             reportDiagnostic,
                                             reportErrorSummary);

    const sb = ts.createSolutionBuilder(sbh, ['.'], {
        verbose: options.verbose,
    });

    while (true) {
        const project = sb.getNextInvalidatedProject();
        if (project === void 0) break;
        project.done(void 0, void 0, {
            before: [fixSourceMap]
        });
    }

    ts.sys.exit(((problemCount > 0) || hasErrors) ? 1 : 0);
}
