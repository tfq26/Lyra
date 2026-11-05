import path from 'node:path';
import { type RepoGraphIndex, type SymbolNode } from './astIndexer';

export interface InvariantViolation {
  id: string;
  type: 'broken_call_site' | 'unhandled_schema_drift' | 'missing_dependency';
  severity: 'high' | 'medium' | 'low';
  message: string;
  sourceFile: string;
  sourceLine?: number;
  offendingSymbol?: string;
  suggestedFix?: string;
}

export interface StackTraceMapping {
  originalTrace: string;
  parsedError: {
    message: string;
    file?: string;
    line?: number;
    symbol?: string;
  };
  matchedNode?: SymbolNode;
  impactedCallers: SymbolNode[];
  relatedFiles: string[];
}

export class InvariantDetector {
  /**
   * Scans a RepoGraphIndex to find broken call-sites or invariant drift across files.
   */
  public detectInvariants(index: RepoGraphIndex): InvariantViolation[] {
    const violations: InvariantViolation[] = [];

    // Check all call sites in symbols against known symbols and imports
    for (const [_, entry] of index.files) {
      const availableLocals = new Set(entry.symbols.map((s) => s.symbolName));
      const availableImports = new Set(entry.imports.flatMap((i) => i.symbols));

      for (const sym of entry.symbols) {
        for (const call of sym.callSites) {
          // If a call is made but not imported or locally declared, and exists elsewhere in the repo
          if (!availableLocals.has(call) && !availableImports.has(call)) {
            const matchesElsewhere = Array.from(index.symbolIndex.values()).filter(
              (s) => s.symbolName === call && s.filePath !== entry.filePath
            );

            if (matchesElsewhere.length > 0) {
              violations.push({
                id: `broken-${entry.filePath}-${sym.symbolName}-${call}`,
                type: 'broken_call_site',
                severity: 'high',
                sourceFile: entry.filePath,
                sourceLine: sym.line,
                offendingSymbol: call,
                message: `Call-site \`${call}()\` in \`${sym.symbolName}\` is neither locally defined nor imported in \`${entry.filePath}\`, but defined in \`${matchesElsewhere[0]!.filePath}\`.`,
                suggestedFix: `Add import \`import { ${call} } from './${path.relative(path.dirname(entry.filePath), matchesElsewhere[0]!.filePath).replace(/\\/g, '/').replace(/\.ts$/, '')}'\`.`,
              });
            }
          }
        }
      }
    }

    return violations;
  }

  /**
   * Maps an error stack trace or CI failure output to exact AST nodes and impacted callers.
   */
  public mapStackTrace(index: RepoGraphIndex, stackTrace: string): StackTraceMapping {
    // 1. Extract file and line from runtime stack trace e.g.: at handleInvoice (server/billing.ts:42:15)
    const traceMatch = stackTrace.match(/at\s+(?:([A-Za-z0-9_$.]+)\s+\()?([A-Za-z0-9_./-]+\.[a-zA-Z0-9]+):(\d+)(?::\d+)?\)?/);
    const errorMsgMatch = stackTrace.match(/(?:Error|TypeError|ReferenceError|Exception):\s*([^\n\r]+)/i);

    // 2. Extract file and line from TypeScript / compiler logs e.g.: src/App.tsx:6:5 - error TS17004: Cannot use JSX...
    const tsMatch = stackTrace.match(/([A-Za-z0-9_./-]+\.[a-zA-Z0-9]+):(\d+):(\d+)\s*-\s*error\s*(?:TS\d+)?:\s*([^\n\r]+)/);
    const tsMatchAlt = stackTrace.match(/([A-Za-z0-9_./-]+\.[a-zA-Z0-9]+)\((\d+),(\d+)\):\s*error\s*(?:TS\d+)?:\s*([^\n\r]+)/);

    let parsedFile = traceMatch ? traceMatch[2]?.replace(/^\.\//, '') : undefined;
    let parsedLine = traceMatch ? parseInt(traceMatch[3]!, 10) : undefined;
    let parsedSymbol = traceMatch ? traceMatch[1] : undefined;
    let parsedMessage = errorMsgMatch ? errorMsgMatch[1]!.trim() : undefined;

    if (!parsedFile && (tsMatch || tsMatchAlt)) {
      const m = (tsMatch || tsMatchAlt)!;
      parsedFile = m[1]?.replace(/^\.\//, '');
      parsedLine = parseInt(m[2]!, 10);
      parsedMessage = m[4]?.trim();
    }

    if (!parsedMessage) {
      const candidateLine = stackTrace
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'));
      parsedMessage = candidateLine ? candidateLine.slice(0, 180) : 'Unknown build or runtime failure';
    }

    const parsed = {
      message: parsedMessage,
      symbol: parsedSymbol,
      file: parsedFile,
      line: parsedLine,
    };

    let matchedNode: SymbolNode | undefined;
    if (parsed.file) {
      const entry = index.files.get(parsed.file);
      if (entry) {
        if (parsed.symbol) {
          matchedNode = entry.symbols.find((s) => s.symbolName === parsed.symbol);
        }
        if (!matchedNode && parsed.line) {
          // Find symbol nearest to the failure line
          matchedNode = entry.symbols
            .filter((s) => s.line <= (parsed.line || 0))
            .sort((a, b) => b.line - a.line)[0];
        }
      }
    }

    const impactedCallers: SymbolNode[] = [];
    if (matchedNode) {
      const callerIds = index.callerIndex.get(matchedNode.symbolName) || new Set();
      for (const cid of callerIds) {
        const caller = index.symbolIndex.get(cid);
        if (caller) impactedCallers.push(caller);
      }
    }

    // Extract all source files explicitly mentioned in compiler/test output
    const mentionedFiles: string[] = [];
    const fileRegex = /(?:^|\s|['"(/])([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|json))(?::|\)|\s|['"]|$)/gm;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = fileRegex.exec(stackTrace)) !== null) {
      const f = fileMatch[1]!.replace(/^\.\//, '');
      if (f.includes('node_modules') || f.startsWith('.git') || f.startsWith('.lyra')) continue;

      let resolvedF: string | undefined = index.files.has(f) ? f : undefined;
      if (!resolvedF) {
        for (const indexedPath of index.files.keys()) {
          if (indexedPath.endsWith(`/${f}`) || indexedPath === f) {
            resolvedF = indexedPath;
            break;
          }
        }
      }
      if (!resolvedF && (f.endsWith('tsconfig.json') || f.endsWith('vite.config.ts') || f.endsWith('package.json'))) {
        resolvedF = f;
      }
      if (resolvedF && !mentionedFiles.includes(resolvedF)) {
        mentionedFiles.push(resolvedF);
      }
    }

    // If JSX errors or tsconfig are mentioned, ensure tsconfig.json is prioritized
    if (
      (stackTrace.includes('--jsx') || stackTrace.includes('JSX') || stackTrace.includes('tsconfig')) &&
      index.files.has('tsconfig.json')
    ) {
      mentionedFiles.unshift('tsconfig.json');
    }

    const relatedFiles = Array.from(
      new Set([
        ...(parsed.file ? [parsed.file] : []),
        ...(matchedNode ? [matchedNode.filePath] : []),
        ...mentionedFiles,
        ...impactedCallers.map((c) => c.filePath),
      ])
    );

    return {
      originalTrace: stackTrace,
      parsedError: parsed,
      matchedNode,
      impactedCallers,
      relatedFiles,
    };
  }
}

export const invariantDetector = new InvariantDetector();
