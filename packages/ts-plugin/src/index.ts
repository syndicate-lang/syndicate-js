import { compile, Syntax } from '@syndicate-lang/compiler';
import tslib from 'typescript/lib/tsserverlibrary';
import crypto from 'crypto';
import path from 'path';

const boot: tslib.server.PluginModuleFactory = ({ typescript: ts }) => {

    interface SyndicateInfo {
        sourceFile: ts.SourceFile;
        originalSource: string;
        targetToSourceMap: Syntax.SpanIndex<Syntax.Token>;
        sourceToTargetMap: Syntax.SpanIndex<number>;
    }

    const syndicateInfo: Map<string, SyndicateInfo> = new Map();

    const syndicateRootDirs: Set<string> = new Set();

    function getInfo(fileName: string): SyndicateInfo | undefined {
        return syndicateInfo.get(fileName);
    }

    function fixupDocumentSpan(loc: ts.DocumentSpan | undefined): ts.DocumentSpan | undefined {
        if (loc !== void 0) {
            withFileName(loc.fileName, () => void 0, (fixupLoc) => {
                fixupLoc.span(loc.textSpan);
                fixupLoc.span(loc.contextSpan);
            });
            withFileName(loc.originalFileName, () => void 0, (fixupOriginal) => {
                fixupOriginal.span(loc.originalTextSpan);
                fixupOriginal.span(loc.originalContextSpan);
            });
        }
        return loc;
    }

    class Fixup {
        readonly info: SyndicateInfo;

        constructor(info: SyndicateInfo) {
            this.info = info;
        }

        loc(start: number): number | undefined {
            const p = this.info.targetToSourceMap.get(start);
            if (p === null) return undefined;
            return p.firstItem.start.pos + p.offset;
        }

        span(s: ts.TextSpan | undefined): ts.TextSpan | undefined {
            if (s !== void 0) {
                const newStart = this.loc(s.start);
                if (newStart === void 0) throw new Error("Source position unavailable for TextSpan " + JSON.stringify(s));
                s.start = newStart;
            }
            return s;
        }

        diagnostic<T extends ts.Diagnostic>(d: T, ds: T[]) {
            if (d.start !== void 0) {
                const p = this.info.targetToSourceMap.get(d.start);
                if (p === null) return;
                if (p.firstItem.synthetic) return;
                d.start = p.firstItem.start.pos + p.offset;
            }
            ds.push(d);
        }

        diagnostics<T extends ts.Diagnostic>(ds: T[]): T[] {
            const vs: T[] = [];
            ds.forEach(d => this.diagnostic(d, vs));
            return vs;
        }
    }

    class PositionFixup extends Fixup {
        readonly target: Syntax.SpanResult<number>;

        constructor(info: SyndicateInfo, target: Syntax.SpanResult<number>) {
            super(info);
            this.target = target;
        }

        get targetStart(): number {
            return this.target.firstItem + this.target.offset;
        }
    }

    function withFileName<T>(fileName: string | undefined,
                             kNoInfo: () => T,
                             k: (f: Fixup) => T): T
    {
        if (fileName === void 0) return kNoInfo();
        const info = getInfo(fileName);
        if (info === void 0) return kNoInfo();
        return k(new Fixup(info));
    }

    function withPosition<T>(fileName: string,
                             position: number,
                             kNoInfo: () => T,
                             kNoPosition: () => T,
                             k: (f: PositionFixup) => T): T
    {
        return withFileName(fileName, kNoInfo, (fx) => {
            const t = fx.info.sourceToTargetMap.get(position);
            if (t === null) return kNoPosition();
            return k(new PositionFixup(fx.info, t));
        });
    }

    function hookHost(host0: ts.CompilerHost | undefined,
                      options: ts.CompilerOptions)
    {
        const host = (host0 === void 0) ? ts.createCompilerHost(options, true) : host0;

        if ('Syndicate_hooked' in host) {
            console.warn('Syndicate plugin refusing to hook CompilerHost twice');
        } else {
            (host as any).Syndicate_hooked = true;

            const oldGetSourceFile = host.getSourceFile;
            host.getSourceFile = getSourceFile;

            function getSourceFile(fileName: string,
                                   languageVersion: ts.ScriptTarget,
                                   onError?: ((message: string) => void),
                                   shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined
            {
                let shouldExpand = false;
                syndicateRootDirs.forEach(d => {
                    if (fileName.startsWith(d)) {
                        shouldExpand = true;
                    }
                });
                if (shouldExpand) {
                    try {
                        const inputText = host.readFile(fileName);
                        if (inputText === void 0) {
                            onError?.(`Could not read input file ${fileName}`);
                            return undefined;
                        }
                        console.log('Syndicate compiling', fileName);
                        const { text: expandedText, targetToSourceMap, sourceToTargetMap } = compile({
                            source: inputText,
                            name: fileName,
                            typescript: true,
                        });
                        const sf = ts.createSourceFile(fileName, expandedText, languageVersion, true);
                        syndicateInfo.set(fileName, {
                            sourceFile: sf,
                            originalSource: inputText,
                            targetToSourceMap,
                            sourceToTargetMap,
                        });
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
            }
        }

        return host;
    }

    {
        const oldCreateProgram = ts.createProgram;

        function createProgram(createProgramOptions: ts.CreateProgramOptions): ts.Program;
        function createProgram(rootNames: readonly string[],
                               options: ts.CompilerOptions,
                               host?: ts.CompilerHost,
                               oldProgram?: ts.Program,
                               configFileParsingDiagnostics?: readonly ts.Diagnostic[]): ts.Program;
        function createProgram(rootNamesOrOptions: readonly string[] | ts.CreateProgramOptions,
                               options?: ts.CompilerOptions,
                               host?: ts.CompilerHost,
                               oldProgram?: ts.Program,
                               configFileParsingDiagnostics?: readonly ts.Diagnostic[])
        : ts.Program
        {
            if (Array.isArray(rootNamesOrOptions)) {
                const rootNames = rootNamesOrOptions;
                host = hookHost(host, options!);
                return oldCreateProgram(rootNames, options!, host, oldProgram, configFileParsingDiagnostics);
            } else {
                const createProgramOptions = rootNamesOrOptions as ts.CreateProgramOptions;
                createProgramOptions.host =
                    hookHost(createProgramOptions.host, createProgramOptions.options);
                return oldCreateProgram(createProgramOptions);
            }
        }

        ts.createProgram = createProgram;
    }

    class SyndicateLanguageService implements ts.LanguageService {
        readonly inner: ts.LanguageService;

        constructor(inner: ts.LanguageService) {
            this.inner = inner;
        }

        cleanupSemanticCache(): void {
        }

        getSyntacticDiagnostics(fileName: string): ts.DiagnosticWithLocation[] {
            const ds = this.inner.getSyntacticDiagnostics(fileName);
            return withFileName(fileName, () => ds, (fixup) => fixup.diagnostics(ds));
        }

        getSemanticDiagnostics(fileName: string): ts.Diagnostic[] {
            const ds = this.inner.getSemanticDiagnostics(fileName);
            return withFileName(fileName, () => ds, (fixup) => fixup.diagnostics(ds));
        }

        getSuggestionDiagnostics(fileName: string): ts.DiagnosticWithLocation[] {
            const ds = this.inner.getSuggestionDiagnostics(fileName);
            return withFileName(fileName, () => ds, (fixup) => fixup.diagnostics(ds));
        }

        getCompilerOptionsDiagnostics(): ts.Diagnostic[] {
            return this.inner.getCompilerOptionsDiagnostics();
        }

        getSyntacticClassifications(fileName: string, span: ts.TextSpan): ts.ClassifiedSpan[];
        getSyntacticClassifications(fileName: string, span: ts.TextSpan, format: ts.SemanticClassificationFormat): ts.ClassifiedSpan[] | ts.ClassifiedSpan2020[];
        getSyntacticClassifications(fileName: string, span: ts.TextSpan, format?: ts.SemanticClassificationFormat): ts.ClassifiedSpan[] | ts.ClassifiedSpan2020[] {
            return withPosition(
                fileName, span.start,
                () => this.inner.getSyntacticClassifications(fileName, span, format!),
                () => [],
                (fixup) => {
                    const cs = this.inner.getSyntacticClassifications(fileName, span, format!);
                    cs.forEach((c: ts.ClassifiedSpan | ts.ClassifiedSpan2020) => fixup.span(c.textSpan));
                    return cs;
                });
        }

        getSemanticClassifications(fileName: string, span: ts.TextSpan): ts.ClassifiedSpan[];
        getSemanticClassifications(fileName: string, span: ts.TextSpan, format: ts.SemanticClassificationFormat): ts.ClassifiedSpan[] | ts.ClassifiedSpan2020[];
        getSemanticClassifications(fileName: any, span: ts.TextSpan, format?: ts.SemanticClassificationFormat): ts.ClassifiedSpan[] | ts.ClassifiedSpan2020[] {
            return withPosition(
                fileName, span.start,
                () => this.inner.getSemanticClassifications(fileName, span, format!),
                () => [],
                (fixup) => {
                    const cs = this.inner.getSemanticClassifications(fileName, span, format!);
                    cs.forEach((c: ts.ClassifiedSpan | ts.ClassifiedSpan2020) => fixup.span(c.textSpan));
                    return cs;
                });
        }

        getEncodedSyntacticClassifications(fileName: string, span: ts.TextSpan): ts.Classifications {
            return withPosition(
                fileName, span.start,
                () => this.inner.getEncodedSyntacticClassifications(fileName, span),
                () => ({ spans: [], endOfLineState: ts.EndOfLineState.None }),
                (fixup) => {
                    const cs = this.inner.getEncodedSyntacticClassifications(fileName, span);
                    for (let i = 0; i < cs.spans.length; i += 3) {
                        const newStart = fixup.loc(cs.spans[i]);
                        if (newStart === void 0) {
                            cs.spans.splice(i, 3);
                        } else {
                            cs.spans[i] = newStart;
                        }
                    }
                    return cs;
                });
        }

        getEncodedSemanticClassifications(fileName: string, span: ts.TextSpan, format?: ts.SemanticClassificationFormat): ts.Classifications {
            return withPosition(
                fileName, span.start,
                () => this.inner.getEncodedSemanticClassifications(fileName, span, format),
                () => ({ spans: [], endOfLineState: ts.EndOfLineState.None }),
                (fixup) => {
                    const cs = this.inner.getEncodedSemanticClassifications(fileName, span, format);
                    for (let i = 0; i < cs.spans.length; i += 3) {
                        const newStart = fixup.loc(cs.spans[i]);
                        if (newStart === void 0) {
                            cs.spans.splice(i, 3);
                        } else {
                            cs.spans[i] = newStart;
                        }
                    }
                    return cs;
                });
        }

        getCompletionsAtPosition(fileName: string, position: number, options: ts.GetCompletionsAtPositionOptions | undefined): ts.WithMetadata<ts.CompletionInfo> | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getCompletionsAtPosition(fileName, position, options),
                () => void 0,
                (fixup) => {
                    const cs = this.inner.getCompletionsAtPosition(fileName, fixup.targetStart, options);
                    if (cs !== void 0) {
                        fixup.span(cs.optionalReplacementSpan);
                        cs.entries.forEach(c => fixup.span(c.replacementSpan));
                    }
                    return cs;
                });
        }

        getCompletionEntryDetails(fileName: string, position: number, entryName: string, formatOptions: ts.FormatCodeOptions | ts.FormatCodeSettings | undefined, source: string | undefined, preferences: ts.UserPreferences | undefined): ts.CompletionEntryDetails | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getCompletionEntryDetails(fileName, position, entryName, formatOptions, source, preferences),
                () => void 0,
                (fixup) => {
                    const d = this.inner.getCompletionEntryDetails(fileName, fixup.targetStart, entryName, formatOptions, source, preferences);
                    if (d !== void 0) {
                        d.codeActions?.forEach(a =>
                            a.changes.forEach(c =>
                                c.textChanges.forEach(c =>
                                    fixup.span(c.span))));
                    }
                    return d;
                });
        }

        getCompletionEntrySymbol(fileName: string, position: number, name: string, source: string | undefined): ts.Symbol | undefined {
            // TODO: hmm. Is this acceptable?
            return void 0;
        }

        getQuickInfoAtPosition(fileName: string, position: number): ts.QuickInfo | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getQuickInfoAtPosition(fileName, position),
                () => void 0,
                (fixup) => {
                    const qi = this.inner.getQuickInfoAtPosition(fileName, fixup.targetStart);
                    if (qi !== void 0) fixup.span(qi.textSpan);
                    return qi;
                });
        }

        getNameOrDottedNameSpan(fileName: string, startPos: number, endPos: number): ts.TextSpan | undefined {
            throw new Error('Method not implemented.');
        }

        getBreakpointStatementAtPosition(fileName: string, position: number): ts.TextSpan | undefined {
            throw new Error('Method not implemented.');
        }

        getSignatureHelpItems(fileName: string, position: number, options: ts.SignatureHelpItemsOptions | undefined): ts.SignatureHelpItems | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getSignatureHelpItems(fileName, position, options),
                () => void 0,
                (fixup) => {
                    const items = this.inner.getSignatureHelpItems(fileName, fixup.targetStart, options);
                    if (items !== void 0) fixup.span(items.applicableSpan);
                    return items;
                });
        }

        getRenameInfo(fileName: string, position: number, options?: ts.RenameInfoOptions): ts.RenameInfo {
            return withPosition(
                fileName, position,
                () => this.inner.getRenameInfo(fileName, position, options),
                () => ({ canRename: false, localizedErrorMessage: 'Identifier not present in expanded source code' }),
                (fixup) => {
                    const ri = this.inner.getRenameInfo(fileName, fixup.targetStart, options);
                    if (ri.canRename) {
                        fixup.span(ri.triggerSpan);
                    }
                    return ri;
                });
        }

        findRenameLocations(fileName: string, position: number, findInStrings: boolean, findInComments: boolean, providePrefixAndSuffixTextForRename?: boolean): readonly ts.RenameLocation[] | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.findRenameLocations(fileName, position, findInStrings, findInComments, providePrefixAndSuffixTextForRename),
                () => void 0,
                (fixup) => {
                    const locs = this.inner.findRenameLocations(fileName, fixup.targetStart, findInStrings, findInComments, providePrefixAndSuffixTextForRename);
                    if (locs !== void 0) locs.forEach(fixupDocumentSpan);
                    return locs;
                });
        }

        getSmartSelectionRange(fileName: string, position: number): ts.SelectionRange {
            throw new Error('Method not implemented.');
        }

        getDefinitionAtPosition(fileName: string, position: number): readonly ts.DefinitionInfo[] | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getDefinitionAtPosition(fileName, position),
                () => undefined,
                (fixup) => {
                    const dis = this.inner.getDefinitionAtPosition(fileName, fixup.targetStart);
                    if (dis !== void 0) dis.forEach(fixupDocumentSpan);
                    return dis;
                });
        }

        getDefinitionAndBoundSpan(fileName: string, position: number): ts.DefinitionInfoAndBoundSpan | undefined {
            throw new Error('Method not implemented.');
        }

        getTypeDefinitionAtPosition(fileName: string, position: number): readonly ts.DefinitionInfo[] | undefined {
            throw new Error('Method not implemented.');
        }

        getImplementationAtPosition(fileName: string, position: number): readonly ts.ImplementationLocation[] | undefined {
            throw new Error('Method not implemented.');
        }

        getReferencesAtPosition(fileName: string, position: number): ts.ReferenceEntry[] | undefined {
            throw new Error('Method not implemented.');
        }

        findReferences(fileName: string, position: number): ts.ReferencedSymbol[] | undefined {
            throw new Error('Method not implemented.');
        }

        getDocumentHighlights(fileName: string, position: number, filesToSearch: string[]): ts.DocumentHighlights[] | undefined {
            return withPosition(
                fileName, position,
                () => this.inner.getDocumentHighlights(fileName, position, filesToSearch),
                () => [],
                fixup => {
                    const dhs = this.inner.getDocumentHighlights(fileName, fixup.targetStart, filesToSearch);
                    if (dhs === void 0) return dhs;
                    dhs.forEach(dh => dh.highlightSpans.forEach((s: tslib.HighlightSpan) => {
                        fixup.span(s.textSpan);
                        fixup.span(s.contextSpan);
                    }));
                    return dhs;
                });
        }

        getOccurrencesAtPosition(fileName: string, position: number): readonly ts.ReferenceEntry[] | undefined {
            throw new Error('Method not implemented.');
        }

        getNavigateToItems(searchValue: string, maxResultCount?: number, fileName?: string, excludeDtsFiles?: boolean): ts.NavigateToItem[] {
            throw new Error('Method not implemented.');
        }

        getNavigationBarItems(fileName: string): ts.NavigationBarItem[] {
            throw new Error('Method not implemented.');
        }

        getNavigationTree(fileName: string): ts.NavigationTree {
            throw new Error('Method not implemented.');
        }

        prepareCallHierarchy(fileName: string, position: number): ts.CallHierarchyItem | ts.CallHierarchyItem[] | undefined {
            throw new Error('Method not implemented.');
        }

        provideCallHierarchyIncomingCalls(fileName: string, position: number): ts.CallHierarchyIncomingCall[] {
            throw new Error('Method not implemented.');
        }

        provideCallHierarchyOutgoingCalls(fileName: string, position: number): ts.CallHierarchyOutgoingCall[] {
            throw new Error('Method not implemented.');
        }

        getOutliningSpans(fileName: string): ts.OutliningSpan[] {
            throw new Error('Method not implemented.');
        }

        getTodoComments(fileName: string, descriptors: ts.TodoCommentDescriptor[]): ts.TodoComment[] {
            throw new Error('Method not implemented.');
        }

        getBraceMatchingAtPosition(fileName: string, position: number): ts.TextSpan[] {
            throw new Error('Method not implemented.');
        }

        getIndentationAtPosition(fileName: string, position: number, options: ts.EditorOptions | ts.EditorSettings): number {
            throw new Error('Method not implemented.');
        }

        getFormattingEditsForRange(fileName: string, start: number, end: number, options: ts.FormatCodeOptions | ts.FormatCodeSettings): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        getFormattingEditsForDocument(fileName: string, options: ts.FormatCodeOptions | ts.FormatCodeSettings): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        getFormattingEditsAfterKeystroke(fileName: string, position: number, key: string, options: ts.FormatCodeOptions | ts.FormatCodeSettings): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        getDocCommentTemplateAtPosition(fileName: string, position: number): ts.TextInsertion | undefined {
            throw new Error('Method not implemented.');
        }

        isValidBraceCompletionAtPosition(fileName: string, position: number, openingBrace: number): boolean {
            throw new Error('Method not implemented.');
        }

        getJsxClosingTagAtPosition(fileName: string, position: number): ts.JsxClosingTagInfo | undefined {
            throw new Error('Method not implemented.');
        }

        getSpanOfEnclosingComment(fileName: string, position: number, onlyMultiLine: boolean): ts.TextSpan | undefined {
            throw new Error('Method not implemented.');
        }

        getCodeFixesAtPosition(fileName: string, start: number, end: number, errorCodes: readonly number[], formatOptions: ts.FormatCodeSettings, preferences: ts.UserPreferences): readonly ts.CodeFixAction[] {
            throw new Error('Method not implemented.');
        }

        getCombinedCodeFix(scope: ts.CombinedCodeFixScope, fixId: {}, formatOptions: ts.FormatCodeSettings, preferences: ts.UserPreferences): ts.CombinedCodeActions {
            throw new Error('Method not implemented.');
        }

        applyCodeActionCommand(action: ts.InstallPackageAction, formatSettings?: ts.FormatCodeSettings): Promise<ts.ApplyCodeActionCommandResult>;
        applyCodeActionCommand(action: ts.InstallPackageAction[], formatSettings?: ts.FormatCodeSettings): Promise<ts.ApplyCodeActionCommandResult[]>;
        applyCodeActionCommand(action: ts.InstallPackageAction | ts.InstallPackageAction[], formatSettings?: ts.FormatCodeSettings): Promise<ts.ApplyCodeActionCommandResult | ts.ApplyCodeActionCommandResult[]>;
        applyCodeActionCommand(fileName: string, action: ts.InstallPackageAction): Promise<ts.ApplyCodeActionCommandResult>;
        applyCodeActionCommand(fileName: string, action: ts.InstallPackageAction[]): Promise<ts.ApplyCodeActionCommandResult[]>;
        applyCodeActionCommand(fileName: string, action: ts.InstallPackageAction | ts.InstallPackageAction[]): Promise<ts.ApplyCodeActionCommandResult | ts.ApplyCodeActionCommandResult[]>;
        applyCodeActionCommand(fileName: any, action?: any): any {
            throw new Error('Method not implemented.');
        }

        getApplicableRefactors(fileName: string, positionOrRange: number | ts.TextRange, preferences: ts.UserPreferences | undefined, triggerReason?: ts.RefactorTriggerReason): ts.ApplicableRefactorInfo[] {
            throw new Error('Method not implemented.');
        }

        getEditsForRefactor(fileName: string, formatOptions: ts.FormatCodeSettings, positionOrRange: number | ts.TextRange, refactorName: string, actionName: string, preferences: ts.UserPreferences | undefined): ts.RefactorEditInfo | undefined {
            throw new Error('Method not implemented.');
        }

        organizeImports(scope: ts.CombinedCodeFixScope, formatOptions: ts.FormatCodeSettings, preferences: ts.UserPreferences | undefined): readonly ts.FileTextChanges[] {
            throw new Error('Method not implemented.');
        }

        getEditsForFileRename(oldFilePath: string, newFilePath: string, formatOptions: ts.FormatCodeSettings, preferences: ts.UserPreferences | undefined): readonly ts.FileTextChanges[] {
            throw new Error('Method not implemented.');
        }

        getEmitOutput(fileName: string, emitOnlyDtsFiles?: boolean, forceDtsEmit?: boolean): ts.EmitOutput {
            throw new Error('Method not implemented.');
        }

        getProgram(): ts.Program | undefined {
            return this.inner.getProgram();
        }

        toggleLineComment(fileName: string, textRange: ts.TextRange): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        toggleMultilineComment(fileName: string, textRange: ts.TextRange): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        commentSelection(fileName: string, textRange: ts.TextRange): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        uncommentSelection(fileName: string, textRange: ts.TextRange): ts.TextChange[] {
            throw new Error('Method not implemented.');
        }

        dispose(): void {
            throw new Error('Method not implemented.');
        }

        getNonBoundSourceFile(fileName: string): ts.SourceFile {
            throw new Error('Method not implemented.');
        }

        getAutoImportProvider(): ts.Program | undefined {
            throw new Error('Method not implemented.');
        }

        toLineColumnOffset(fileName: string, position: number): ts.LineAndCharacter {
            function search(t: string | undefined, position: number): ts.LineAndCharacter {
                if (t === void 0) return { line: 0, character: 0 };
                const p = Syntax.startPos(fileName);
                for (let i = 0; i < position; i++) Syntax.advancePos(p, t[i]);
                return { line: p.line - 1, character: p.column };
            }
            return withFileName(
                fileName,
                () => (this.inner.toLineColumnOffset?.(fileName, position) ??
                    search(this.inner.getProgram()?.getSourceFile(fileName)?.text, position)),
                (fixup) =>
                    search(fixup.info.originalSource, position));
        }

        // getSourceMapper(): ts.SourceMapper {
        //     throw new Error('Method not implemented.');
        // }

        clearSourceMapperCache(): void {
            throw new Error('Method not implemented.');
        }
    }

    class SyndicatePlugin implements ts.server.PluginModule {
        create(createInfo: ts.server.PluginCreateInfo): ts.LanguageService {
            const options = createInfo.project.getCompilerOptions();
            if (options.rootDir !== void 0) {
                syndicateRootDirs.add(options.rootDir);
            }
            if (options.rootDirs !== void 0) {
                options.rootDirs.forEach(d => syndicateRootDirs.add(d));
            }
            if (options.rootDir === void 0 && options.rootDirs === void 0) {
                syndicateRootDirs.add(path.resolve('.'));
            }
            return new SyndicateLanguageService(createInfo.languageService);
        }
    }

    return new SyndicatePlugin();

};
export = boot;
