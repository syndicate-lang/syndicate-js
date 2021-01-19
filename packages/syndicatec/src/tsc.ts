import yargs from 'yargs/yargs';
import ts from 'typescript';
import crypto from 'crypto';

import { compile } from '@syndicate-lang/compiler';

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
                const expandedText = compile({
                    source: inputText,
                    name: fileName,
                    typescript: true,
                }).text;
                console.log('\n\n', fileName);
                expandedText.split(/\n/).forEach((line, i) => {
                    console.log(i, line);
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

export function main(argv: string[]) {
    const sbh = ts.createSolutionBuilderHost(ts.sys,
                                             createProgram,
                                             reportDiagnostic,
                                             reportDiagnostic,
                                             reportErrorSummary);
    const sb = ts.createSolutionBuilder(sbh, ['.'], {
        verbose: true,
    });
    ts.sys.exit(sb.build());
}
