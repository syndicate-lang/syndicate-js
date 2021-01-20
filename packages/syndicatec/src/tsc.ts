import ts from 'typescript';
import crypto from 'crypto';

import { compile } from '@syndicate-lang/compiler';
import { SourcePositionIndex } from '@syndicate-lang/compiler/lib/compiler/codegen';

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
    positionIndex: SourcePositionIndex;
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
                const { text: expandedText, positionIndex } = compile({
                    source: inputText,
                    name: fileName,
                    typescript: true,
                });
                syndicateInfo.set(fileName, {
                    originalSource: inputText,
                    positionIndex,
                });
                const sf = ts.createSourceFile(fileName, expandedText, languageVersion, true);
                (sf as any).version = crypto.createHash('sha256').update(expandedText).digest('hex');
                return sf;
            } catch (e) {
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

export function fixSourceMap(ctx: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    return sf => {
        const fileName = sf.fileName;
        const info = syndicateInfo.get(fileName);
        if (info === void 0) throw new Error("No Syndicate info available for " + fileName);
        const positionIndex = info.positionIndex;

        // console.log('fixSourceMap', fileName, sf.text.length, info.originalSource.length);

        const syndicateSource = ts.createSourceMapSource(fileName, info.originalSource);
        const expandedSource = ts.createSourceMapSource(fileName + '.expanded', sf.text);

        function adjustSourceMap(n: ts.Node) {
            const ps = positionIndex.sourcePositionAt(n.pos);
            const pe = positionIndex.sourcePositionAt(n.end);
            if (ps.name === fileName && pe.name === fileName) {
                ts.setSourceMapRange(n, { pos: ps.pos, end: pe.pos, source: syndicateSource });
                // console.group(ts.SyntaxKind[n.kind], `${n.pos}-${n.end} ==> ${ps.pos}-${pe.pos}`);
            } else if (ps.name === null && pe.name === null) {
                ts.setSourceMapRange(n, { pos: ps.pos, end: pe.pos, source: expandedSource });
                // console.group(ts.SyntaxKind[n.kind], n.pos, 'synthetic');
            } else if (ps.name === null) {
                ts.setSourceMapRange(n, { pos: pe.pos, end: pe.pos, source: expandedSource });
                // console.group(ts.SyntaxKind[n.kind], n.pos, 'mixed end');
            } else {
                ts.setSourceMapRange(n, { pos: ps.pos, end: ps.pos, source: expandedSource });
                // console.group(ts.SyntaxKind[n.kind], n.pos, 'mixed start');
            }
            ts.forEachChild(n, adjustSourceMap);
            // console.groupEnd();
        }

        adjustSourceMap(sf);

        return sf;
    };
}

export function main(argv: string[]) {
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
