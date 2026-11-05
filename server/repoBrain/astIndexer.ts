import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspacePath } from '../nativeTools';

export interface SymbolNode {
  id: string; // "server/billing/stripeWebhook.ts#handleInvoiceSuccess"
  filePath: string;
  symbolName: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'schema';
  line: number;
  callSites: string[];
  dependencies: string[];
  schemaReferences: string[];
}

export interface FileIndexEntry {
  filePath: string;
  symbols: SymbolNode[];
  imports: Array<{ from: string; symbols: string[] }>;
  exports: string[];
  lastModified: number;
}

export interface RepoGraphIndex {
  workspacePath: string;
  indexedAt: string;
  totalFiles: number;
  totalSymbols: number;
  files: Map<string, FileIndexEntry>;
  symbolIndex: Map<string, SymbolNode>;
  callerIndex: Map<string, Set<string>>; // callee -> set of caller symbol IDs
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.lyra',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
  'Library',
  '.npm',
  '.cache',
]);

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.prisma', '.sql']);

export class AstIndexer {
  private cache = new Map<string, RepoGraphIndex>();

  /**
   * Recursively scans and indexes the target workspace.
   */
  public async indexWorkspace(workspacePath: string): Promise<RepoGraphIndex> {
    const cached = this.cache.get(workspacePath);
    const filesToScan: string[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) {
            const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
            filesToScan.push(relPath);
          }
        }
      }
    };

    walk(workspacePath);

    const filesMap = new Map<string, FileIndexEntry>();
    const symbolIndex = new Map<string, SymbolNode>();
    const callerIndex = new Map<string, Set<string>>();

    for (const relPath of filesToScan) {
      const fullPath = path.join(workspacePath, relPath);
      const stat = fs.statSync(fullPath);

      // Simple incremental cache check
      if (cached && cached.files.has(relPath)) {
        const prev = cached.files.get(relPath)!;
        if (prev.lastModified === stat.mtimeMs) {
          filesMap.set(relPath, prev);
          for (const sym of prev.symbols) {
            symbolIndex.set(sym.id, sym);
          }
          continue;
        }
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      const entry = this.parseFile(relPath, content, stat.mtimeMs);
      filesMap.set(relPath, entry);

      for (const sym of entry.symbols) {
        symbolIndex.set(sym.id, sym);
      }
    }

    // Build cross-file caller and dependency index
    for (const [_, entry] of filesMap) {
      for (const sym of entry.symbols) {
        for (const call of sym.callSites) {
          if (!callerIndex.has(call)) {
            callerIndex.set(call, new Set());
          }
          callerIndex.get(call)!.add(sym.id);
        }
      }
    }

    const index: RepoGraphIndex = {
      workspacePath,
      indexedAt: new Date().toISOString(),
      totalFiles: filesMap.size,
      totalSymbols: symbolIndex.size,
      files: filesMap,
      symbolIndex,
      callerIndex,
    };

    this.cache.set(workspacePath, index);
    return index;
  }

  /**
   * Fast lexical and symbol extraction for TypeScript/JavaScript/Prisma files.
   */
  public parseFile(filePath: string, content: string, lastModified: number): FileIndexEntry {
    const lines = content.split(/\r?\n/);
    const symbols: SymbolNode[] = [];
    const imports: Array<{ from: string; symbols: string[] }> = [];
    const exports: string[] = [];

    // Parse imports: import { a, b } from './module'
    const importRegex = /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z0-9_]+))\s+from\s+['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(importRegex)) {
      const named = match[1];
      const defaultImport = match[2];
      const fromPath = match[3]!;
      const importedSymbols: string[] = [];

      if (named) {
        importedSymbols.push(...named.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean));
      }
      if (defaultImport) {
        importedSymbols.push(defaultImport.trim());
      }
      imports.push({ from: fromPath, symbols: importedSymbols });
    }

    // Parse top-level function/class/interface/type definitions
    const defRegex =
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/;
    const topLevelConstFuncRegex =
      /^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/;

    // Call site pattern: fooBar( but NOT obj.method(
    const callSiteRegex = /(?<!\.)\b([A-Za-z0-9_$]+)\s*\(/g;
    const BUILTIN_CALLS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'require',
      'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'fetch', 'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat',
      'isNaN', 'isFinite', 'Promise', 'Error', 'TypeError', 'RangeError', 'ReferenceError',
      'SyntaxError', 'URIError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'JSON', 'Object',
      'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Math', 'Date', 'Symbol', 'BigInt',
      'describe', 'it', 'test', 'expect', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach',
    ]);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const match = line.match(defRegex);
      const constFuncMatch = line.match(topLevelConstFuncRegex);

      if (match || constFuncMatch) {
        const kindRaw = match ? match[1]! : 'function';
        const symbolName = match ? match[2]! : constFuncMatch![1]!;
        const kind: SymbolNode['kind'] =
          kindRaw === 'function'
            ? 'function'
            : kindRaw === 'class'
            ? 'class'
            : kindRaw === 'interface'
            ? 'interface'
            : kindRaw === 'type'
            ? 'type'
            : 'variable';

        const id = `${filePath}#${symbolName}`;

        // Lookahead lines until the next top-level definition or end of block
        let nextDefIdx = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (defRegex.test(lines[j]!.trim())) {
            nextDefIdx = j;
            break;
          }
        }
        const block = lines.slice(i, nextDefIdx).join('\n');
        const callSites: string[] = [];
        for (const callMatch of block.matchAll(callSiteRegex)) {
          const callee = callMatch[1]!;
          if (callee !== symbolName && !BUILTIN_CALLS.has(callee)) {
            callSites.push(callee);
          }
        }

        // Schema references (Prisma / SQL table patterns)
        const schemaReferences: string[] = [];
        const schemaMatch = block.match(/\b(prisma\.[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_]+|table\s+[a-zA-Z0-9_]+)/gi);
        if (schemaMatch) {
          schemaReferences.push(...new Set(schemaMatch.map((s) => s.toLowerCase())));
        }

        symbols.push({
          id,
          filePath,
          symbolName,
          kind,
          line: i + 1,
          callSites: Array.from(new Set(callSites)),
          dependencies: imports.flatMap((imp) => imp.symbols),
          schemaReferences,
        });

        if (line.startsWith('export')) {
          exports.push(symbolName);
        }
      }
    }

    return {
      filePath,
      symbols,
      imports,
      exports,
      lastModified,
    };
  }

  /**
   * Traces all upstream callers and downstream dependencies of a symbol.
   */
  public traceCallGraph(
    index: RepoGraphIndex,
    symbolName: string
  ): {
    directMatches: SymbolNode[];
    callers: SymbolNode[];
    dependencies: string[];
  } {
    const directMatches = Array.from(index.symbolIndex.values()).filter(
      (s) => s.symbolName === symbolName || s.id.endsWith(`#${symbolName}`)
    );

    const callerIds = index.callerIndex.get(symbolName) || new Set();
    const callers = Array.from(callerIds)
      .map((id) => index.symbolIndex.get(id))
      .filter((s): s is SymbolNode => Boolean(s));

    const dependencies = Array.from(new Set(directMatches.flatMap((s) => s.dependencies)));

    return {
      directMatches,
      callers,
      dependencies,
    };
  }
}

export const astIndexer = new AstIndexer();
