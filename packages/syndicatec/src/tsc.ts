import ts from 'typescript';
import crypto from 'crypto';

import { compile } from '@syndicate-lang/compiler';
import { SpanIndex, Token } from '@syndicate-lang/compiler/lib/syntax';

function reportDiagnostic(diagnostic: ts.Diagnostic) {
    if (diagnostic.file) {
        let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
        let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
        console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
}

function reportErrorSummary(n: number) {
    if (n > 0) {
        console.log(`\n - ${n} errors reported`);
    }
}

interface SyndicateInfo {
    originalSource: string;
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

export function main(_argv: string[]) {
    const sbh = ts.createSolutionBuilderHost(ts.sys,
                                             createProgram,
                                             reportDiagnostic,
                                             reportDiagnostic,
                                             reportErrorSummary);
    const sb = ts.createSolutionBuilder(sbh, ['.'], {
        verbose: true,
    });
    while (true) {
        const project = sb.getNextInvalidatedProject();
        if (project === void 0) break;
        project.done(void 0, void 0, {
            before: [fixSourceMap]
        });
    }
    ts.sys.exit(0);
}
