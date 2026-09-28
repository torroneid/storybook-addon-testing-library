/**
 * Makes vi.mock work in Storybook, where the stories and components have imported a module long before a spec
 * file mocks it.
 *
 * - At startup the plugin finds the modules that spec and setup files mock, and routes every import of them through
 *   a proxy module. The proxy has the original's exports, in variables that vi.mock can set (see preview/mocks.ts).
 * - In the files that call vi.mock, the path becomes a descriptor with the resolved module, because the browser
 *   cannot resolve 'utils/hooks/useFoo' or '../api' the way Vite does.
 */
import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import ts from 'typescript';
import type { Plugin, ViteDevServer } from 'vite';

import { MOCK_PATH_MARKER, MOCKED_MODULES_GLOBAL } from '../shared/types.ts';
import { findSearchRoot, findSpecFiles, isSpecFile } from './specIndex.ts';

const PLUGIN_NAME = 'storybook-addon-testing-library:mocks';
const PROXY_PREFIX = '\0storybook-addon-testing-library/mock:';
/** Passed in resolve calls the plugin makes itself, so it does not answer them with a proxy */
const OWN_RESOLVE = { custom: { [PLUGIN_NAME]: { own: true } } };

// vi.mock('path'), vi.mock<Type>("path", …) and vi.mock(import('path'), …).
// Groups: the call up to the path; import('path') and its path; or 'path' and its path.
const MOCK_CALL =
  /(\b(?:vi|vitest)\s*\.\s*(?:mock|doMock|unmock|doUnmock|importActual|importMock)\s*(?:<.*?>)?\s*\(\s*)(?:(import\s*\(\s*(['"`])([^'"`\n]+)\3\s*\))|((['"`])([^'"`\n]+)\6))/g;
const MOCKS_MODULE = /\b(?:vi|vitest)\s*\.\s*(?:mock|doMock)\s*(?:<.*?>)?\s*\(/;

export const cleanId = (id: string) => id.replace(/[?#].*$/, '');

export type MockCall = { start: number; end: number; path: string };

export const findMockCalls = (code: string): MockCall[] =>
  [...code.matchAll(MOCK_CALL)].map(match => {
    const [, prefix, importExpression, , importPath, literal, , literalPath] = match;
    const start = match.index + prefix.length;
    return { start, end: start + (importExpression ?? literal).length, path: importPath ?? literalPath };
  });

// ---------- Export names ----------

type Resolve = (source: string, importer: string) => Promise<string | undefined>;

const scriptKind = (file: string) =>
  /\.[mc]?ts$/.test(file) ? ts.ScriptKind.TS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false);

const bindingNames = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap(element => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));

/** The names a module exports at runtime, following export * into the modules it re-exports */
export const exportNames = async (
  file: string,
  code: string,
  resolve: Resolve,
  read: (file: string) => string | undefined = file =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined,
  seen = new Set<string>(),
): Promise<Set<string>> => {
  const names = new Set<string>();
  seen.add(file);
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, scriptKind(file));
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (statement.isTypeOnly) {
        continue;
      } else if (clause && ts.isNamespaceExport(clause)) {
        names.add(clause.name.text);
      } else if (clause) {
        clause.elements.filter(element => !element.isTypeOnly).forEach(element => names.add(element.name.text));
      } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const reexported = await resolve(statement.moduleSpecifier.text, file);
        const reexportedCode = reexported && !seen.has(reexported) ? read(reexported) : undefined;
        if (reexported && reexportedCode !== undefined) {
          for (const name of await exportNames(reexported, reexportedCode, resolve, read, seen)) {
            if (name !== 'default') {
              names.add(name);
            }
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) {
        names.add('default');
      }
    } else if (
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
    ) {
      if (ts.isVariableStatement(statement)) {
        statement.declarationList.declarations.flatMap(d => bindingNames(d.name)).forEach(name => names.add(name));
      } else if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)
      ) {
        if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
          names.add('default');
        } else if (statement.name && ts.isIdentifier(statement.name)) {
          names.add(statement.name.text);
        }
      }
    }
  }
  return names;
};

// ---------- Proxy modules ----------

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A module with the original's exports in variables, which vi.mock sets through the registry */
export const proxyModuleCode = (originalId: string, key: string, names: string[]) => {
  const locals = names.map((_, index) => `__e${index}`);
  const exported = names.map(
    (name, index) => `${locals[index]} as ${IDENTIFIER.test(name) ? name : JSON.stringify(name)}`,
  );
  return [
    `import * as __original from ${JSON.stringify(originalId)};`,
    locals.length > 0 ? `let ${locals.join(', ')};` : '',
    locals.length > 0 ? `export { ${exported.join(', ')} };` : '',
    // In an import cycle the original may not have run yet, and reading its exports throws until it has
    `const __set = exports => {`,
    ...names.map((name, index) => `  try { ${locals[index]} = exports[${JSON.stringify(name)}]; } catch {}`),
    `};`,
    `const __modules = (globalThis[${JSON.stringify(MOCKED_MODULES_GLOBAL)}] ??= new Map());`,
    `const __module = __modules.get(${JSON.stringify(key)}) ?? { setters: new Set() };`,
    `__module.original = __original;`,
    `__module.setters.add(__set);`,
    `__modules.set(${JSON.stringify(key)}, __module);`,
    `__set(__module.mock ?? __original);`,
    `queueMicrotask(() => __set(__module.mock ?? __module.original));`,
    '',
  ].join('\n');
};

// ---------- The plugin ----------

type OptimizedDep = { file: string; needsInterop?: boolean };
type DepsOptimizer = {
  metadata: { optimized: Record<string, OptimizedDep>; discovered: Record<string, OptimizedDep> };
};

export const mockPlugin = (specPatterns: string[], setupFiles: string[]): Plugin => {
  const workingDir = process.cwd();
  const absoluteSetupFiles = setupFiles.map(file => path.resolve(workingDir, file));
  /** The resolved modules that some file mocks */
  const targets = new Set<string>();
  /** Proxy module id → the original's resolved id */
  const proxies = new Map<string, string>();
  let server: ViteDevServer | undefined;
  let ready: Promise<void> = Promise.resolve();
  let root = workingDir;

  const mocksModules = (file: string) =>
    absoluteSetupFiles.includes(file) ||
    file.split(path.sep).includes('__mocks__') ||
    isSpecFile(file, specPatterns, workingDir);

  const depsOptimizer = () =>
    (server?.environments.client as unknown as { depsOptimizer?: DepsOptimizer } | undefined)?.depsOptimizer;

  /** Vite rewrites named imports from CommonJS dependencies, and a proxy in between would break that */
  const isCommonJsDependency = (key: string) => {
    const metadata = depsOptimizer()?.metadata;
    return (
      !!metadata &&
      [...Object.values(metadata.optimized), ...Object.values(metadata.discovered)].some(
        dep => cleanId(dep.file) === key && dep.needsInterop,
      )
    );
  };

  const resolveWithServer: Resolve = async (source, importer) => {
    const resolved = await server?.environments.client.pluginContainer.resolveId(source, importer, OWN_RESOLVE);
    return resolved && !resolved.external && !resolved.id.startsWith('\0') ? cleanId(resolved.id) : undefined;
  };

  const reload = () => {
    const environment = server?.environments.client;
    environment?.moduleGraph.invalidateAll();
    environment?.hot.send({ type: 'full-reload' });
  };

  /** Adds what the file mocks; true when there was something new */
  const addTargets = async (file: string, code: string) => {
    if (!MOCKS_MODULE.test(code)) {
      return false;
    }
    let added = false;
    for (const call of findMockCalls(code)) {
      const key = await resolveWithServer(call.path, file);
      if (key && !targets.has(key)) {
        targets.add(key);
        added = true;
      }
    }
    return added;
  };

  const scanFile = async (file: string) => {
    try {
      return await addTargets(file, fs.readFileSync(file, 'utf8'));
    } catch {
      return false;
    }
  };

  const scan = async () => {
    const searchRoot = findSearchRoot(workingDir);
    // Spec patterns are relative to each package root, which can be anywhere below the search root
    const patterns = specPatterns.map(pattern => (pattern.startsWith('**/') ? pattern : `**/${pattern}`));
    const files = [
      ...findSpecFiles([searchRoot], patterns).filter(file => isSpecFile(file, specPatterns, workingDir)),
      ...absoluteSetupFiles,
    ];
    for (const file of files) {
      await scanFile(file);
    }
  };

  const findMocksFile = (key: string, mockPath: string) => {
    const candidates = key.split(path.sep).includes('node_modules')
      ? ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'].map(extension =>
          path.join(root, '__mocks__', `${mockPath}${extension}`),
        )
      : [path.join(path.dirname(key), '__mocks__', path.basename(key))];
    return candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  };

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',
    apply: 'serve',
    configResolved: config => {
      root = config.root;
    },
    configureServer: devServer => {
      server = devServer;
      ready = scan().catch(error => devServer.config.logger.error(`${PLUGIN_NAME}: ${error}`));
      const onFile = (file: string) => {
        if (mocksModules(file)) {
          // A module that is mocked for the first time was loaded without a proxy
          scanFile(file).then(
            added => added && reload(),
            () => undefined,
          );
        }
      };
      devServer.watcher.on('add', onFile);
      devServer.watcher.on('change', onFile);
    },

    async resolveId(source, importer, options) {
      // The browser asks for the proxy by its id
      if (proxies.has(source)) {
        return source;
      }
      if (
        !importer ||
        (options as { scan?: boolean }).scan ||
        options.custom?.[PLUGIN_NAME] ||
        source.startsWith('\0') ||
        importer.startsWith(PROXY_PREFIX)
      ) {
        return undefined;
      }
      await ready;
      if (targets.size === 0) {
        return undefined;
      }
      const resolved = await this.resolve(source, importer, { ...options, ...OWN_RESOLVE, skipSelf: true });
      if (!resolved || resolved.external) {
        return undefined;
      }
      const key = cleanId(resolved.id);
      if (!targets.has(key) || isCommonJsDependency(key)) {
        return undefined;
      }
      const proxyId = `${PROXY_PREFIX}${key}.js`;
      proxies.set(proxyId, resolved.id);
      return proxyId;
    },

    async load(id) {
      const originalId = proxies.get(id);
      if (!originalId) {
        return undefined;
      }
      const key = cleanId(originalId);
      if (!fs.existsSync(key)) {
        // An optimized dependency is written when the optimizer is done
        await this.load({ id: originalId });
      }
      this.addWatchFile(key);
      const names = await exportNames(key, fs.readFileSync(key, 'utf8'), async (source, importer) => {
        const resolved = await this.resolve(source, importer, { ...OWN_RESOLVE, skipSelf: true });
        return resolved && !resolved.external ? cleanId(resolved.id) : undefined;
      });
      return proxyModuleCode(originalId, key, [...names]);
    },

    async transform(code, id) {
      const file = cleanId(id);
      if (id.startsWith('\0') || file.split(path.sep).includes('node_modules') || !mocksModules(file)) {
        return undefined;
      }
      const calls = findMockCalls(code);
      if (calls.length === 0) {
        return undefined;
      }
      await ready;
      const s = new MagicString(code);
      let added = false;
      for (const call of calls) {
        const resolved = await this.resolve(call.path, file, { ...OWN_RESOLVE, skipSelf: true });
        const key = resolved && !resolved.external && !resolved.id.startsWith('\0') ? cleanId(resolved.id) : undefined;
        const literal = JSON.stringify(call.path);
        const error = !key
          ? `vi.mock(${literal}): Storybook could not resolve the module`
          : isCommonJsDependency(key)
            ? `vi.mock(${literal}): CommonJS packages cannot be mocked in Storybook`
            : undefined;
        if (key && !error && !targets.has(key)) {
          targets.add(key);
          added = true;
        }
        const mocksFile = key && !error ? findMocksFile(key, call.path) : undefined;
        const descriptor = [
          `${MOCK_PATH_MARKER}: true`,
          `path: ${literal}`,
          `key: ${JSON.stringify(key ?? '')}`,
          error ? `error: ${JSON.stringify(error)}` : '',
          `load: () => ${error ? 'Promise.resolve()' : `import(${literal})`}`,
          mocksFile ? `mocksFile: () => import(${JSON.stringify(mocksFile)})` : '',
        ]
          .filter(Boolean)
          .join(', ');
        s.overwrite(call.start, call.end, `{ ${descriptor} }`);
      }
      if (added) {
        server?.config.logger.info(
          `${PLUGIN_NAME}: reloading, because a newly mocked module was loaded without a proxy`,
        );
        reload();
      }
      return { code: s.toString(), map: s.generateMap({ hires: 'boundary', source: id }) };
    },
  };
};
