import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import type { NamePart, StoryReference } from '../shared/types.ts';

export type AnalyzedTest = {
  name: NamePart[];
  line: number;
  isTemplate: boolean;
  storyReferences: StoryReference[];
};

export type SpecAnalysis = {
  tests: AnalyzedTest[];
  /** Absolute paths to the stories files the spec file imports */
  storiesFiles: string[];
};

const TEST_FUNCTIONS = new Set(['it', 'test']);
const DESCRIBE_FUNCTIONS = new Set(['describe', 'suite']);
const HOOKS = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll']);
const TEMPLATE_MODIFIERS = new Set(['each', 'for']);
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

const escapeRegex = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** Turns an .each name such as 'formats %s as $expected' into a regex pattern */
const templateToPattern = (text: string) => {
  let pattern = '';
  let forrige = 0;
  for (const treff of text.matchAll(/%[sdifjoOc#$%]|\$[A-Za-z_$][\w$]*(?:\.[\w$]+)*/g)) {
    pattern += escapeRegex(text.slice(forrige, treff.index));
    pattern += treff[0] === '%%' ? '%' : '.*?';
    forrige = treff.index + treff[0].length;
  }
  return pattern + escapeRegex(text.slice(forrige));
};

const toNamePart = (node: ts.Expression | undefined, source: ts.SourceFile, isTemplate: boolean): NamePart => {
  if (!node) {
    return { text: '', pattern: '' };
  }
  const tilMonster = (text: string) => (isTemplate ? templateToPattern(text) : escapeRegex(text));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, pattern: tilMonster(node.text) };
  }
  if (ts.isTemplateExpression(node)) {
    const delar = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
    return {
      text: node.getText(source).slice(1, -1),
      pattern: delar.map(tilMonster).join('.*?'),
    };
  }
  return { text: node.getText(source), pattern: null };
};

const findStoriesFile = (specFile: string, specifier: string) => {
  if (!specifier.startsWith('.') || !/\.stories(\.[jt]sx?)?$/.test(specifier)) {
    return undefined;
  }
  const base = path.resolve(path.dirname(specFile), specifier);
  return [base, ...EXTENSIONS.map(extension => base + extension)].find(
    file => fs.existsSync(file) && fs.statSync(file).isFile(),
  );
};

type Call = {
  type: 'test' | 'describe' | 'krok';
  isTemplate: boolean;
  argument: readonly ts.Expression[];
};

/**
 * Kjenner att it('name', fn), it.skip(...), it.each(tabell)('name', fn), describe.each(...)(...) osv.
 */
const classifyCall = (call: ts.CallExpression): Call | undefined => {
  let expression: ts.Expression = call.expression;
  let isTemplate = false;
  if (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression)) {
    const indre = ts.isCallExpression(expression) ? expression.expression : expression.tag;
    if (!ts.isPropertyAccessExpression(indre) || !TEMPLATE_MODIFIERS.has(indre.name.text)) {
      return undefined;
    }
    isTemplate = true;
    expression = indre.expression;
  }
  const modifiers: string[] = [];
  while (ts.isPropertyAccessExpression(expression)) {
    modifiers.push(expression.name.text);
    expression = expression.expression;
  }
  if (!ts.isIdentifier(expression) || modifiers.some(modifikator => TEMPLATE_MODIFIERS.has(modifikator))) {
    return undefined;
  }
  const name = expression.text;
  const type = TEST_FUNCTIONS.has(name)
    ? 'test'
    : DESCRIBE_FUNCTIONS.has(name)
      ? 'describe'
      : HOOKS.has(name)
        ? 'krok'
        : undefined;
  return type ? { type, isTemplate, argument: call.arguments } : undefined;
};

const findFunctionArgument = (argument: readonly ts.Expression[]) =>
  argument.find(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));

const addUnique = (list: StoryReference[], added: Iterable<StoryReference>) => {
  for (const created of added) {
    if (!list.some(ref => ref.storiesFile === created.storiesFile && ref.exportName === created.exportName)) {
      list.push(created);
    }
  }
  return list;
};

export const analyzeSpecFile = (specFile: string, kjeldekode = fs.readFileSync(specFile, 'utf-8')): SpecAnalysis => {
  const source = ts.createSourceFile(specFile, kjeldekode, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** import * as stories from './X.stories' */
  const storiesNamespaces = new Map<string, string>();
  /** import { Default } from './X.stories' */
  const namedStoriesImports = new Map<string, StoryReference>();
  /** const { Default } = composeStories(stories) */
  const composedStories = new Map<string, StoryReference>();
  /** const alle = composeStories(stories) */
  const composedCollections = new Map<string, string>();
  /** Top level functions and variables, so helpers that use stories can be followed */
  const topLevelDeclarations = new Map<string, ts.Node>();

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const storiesFile = findStoriesFile(specFile, statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (storiesFile && bindings && ts.isNamespaceImport(bindings)) {
        storiesNamespaces.set(bindings.name.text, storiesFile);
      } else if (storiesFile && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const exportName = (element.propertyName ?? element.name).text;
          namedStoriesImports.set(element.name.text, { storiesFile, exportName });
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelDeclarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          topLevelDeclarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  const storyReferenceFromExpression = (expression: ts.Expression | undefined): StoryReference | undefined => {
    if (!expression) {
      return undefined;
    }
    if (ts.isIdentifier(expression)) {
      return namedStoriesImports.get(expression.text);
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const storiesFile = storiesNamespaces.get(expression.expression.text);
      return storiesFile ? { storiesFile, exportName: expression.name.text } : undefined;
    }
    return undefined;
  };

  const findComposeCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      const parent = node.parent;
      if (fn === 'composeStories' && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
        const storiesFile = storiesNamespaces.get(node.arguments[0].text);
        if (storiesFile && ts.isVariableDeclaration(parent)) {
          if (ts.isObjectBindingPattern(parent.name)) {
            for (const element of parent.name.elements) {
              if (ts.isIdentifier(element.name)) {
                const exportName = element.propertyName?.getText(source) ?? element.name.text;
                composedStories.set(element.name.text, { storiesFile, exportName });
              }
            }
          } else if (ts.isIdentifier(parent.name)) {
            composedCollections.set(parent.name.text, storiesFile);
          }
        }
      } else if (fn === 'composeStory' && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        const referanse = storyReferenceFromExpression(node.arguments[0]);
        if (referanse) {
          composedStories.set(parent.name.text, referanse);
        }
      }
    }
    ts.forEachChild(node, findComposeCalls);
  };
  findComposeCalls(source);

  const referenceCache = new Map<ts.Node, StoryReference[]>();

  /**
   * `inProgress` holds the declarations on the current path, so recursive helpers do not loop forever.
   * A result that skipped one of them is missing its references, so it is not cached.
   */
  const collectStoryReferences = (
    root: ts.Node,
    inProgress: Set<ts.Node>,
  ): { references: StoryReference[]; complete: boolean } => {
    const cache = referenceCache.get(root);
    if (cache) {
      return { references: cache, complete: true };
    }
    inProgress.add(root);
    let complete = true;
    const referansar: StoryReference[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const collection = composedCollections.get(node.expression.text);
        const namespace = storiesNamespaces.get(node.expression.text);
        const storiesFile = collection ?? namespace;
        if (storiesFile && node.name.text !== 'default') {
          addUnique(referansar, [{ storiesFile, exportName: node.name.text }]);
        }
      } else if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        const composed = composedStories.get(node.text);
        if (composed) {
          addUnique(referansar, [composed]);
        }
        const declaration = topLevelDeclarations.get(node.text);
        if (declaration && inProgress.has(declaration)) {
          complete = false;
        } else if (declaration) {
          const nested = collectStoryReferences(declaration, inProgress);
          addUnique(referansar, nested.references);
          complete &&= nested.complete;
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(root, visit);
    inProgress.delete(root);
    if (complete) {
      referenceCache.set(root, referansar);
    }
    return { references: referansar, complete };
  };

  const findStoryReferences = (root: ts.Node) => collectStoryReferences(root, new Set()).references;

  const tests: AnalyzedTest[] = [];

  const visitContainer = (container: ts.Node, name: NamePart[], inherited: StoryReference[]) => {
    const statements = ts.isSourceFile(container) || ts.isBlock(container) ? container.statements : [];
    const hookReferences = [...inherited];
    for (const statement of statements) {
      if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        const call = classifyCall(statement.expression);
        if (call?.type === 'krok') {
          addUnique(hookReferences, findStoryReferences(statement.expression));
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const call = classifyCall(node);
        if (call?.type === 'describe') {
          const fn = findFunctionArgument(call.argument);
          const describeName = [...name, toNamePart(call.argument[0], source, call.isTemplate)];
          if (fn && ts.isBlock(fn.body)) {
            visitContainer(fn.body, describeName, hookReferences);
          } else if (fn) {
            visit(fn.body);
          }
          return;
        }
        if (call?.type === 'test') {
          const fn = findFunctionArgument(call.argument);
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          tests.push({
            name: [...name, toNamePart(call.argument[0], source, call.isTemplate)],
            line: line + 1,
            isTemplate: call.isTemplate,
            storyReferences: addUnique([...hookReferences], fn ? findStoryReferences(fn) : []),
          });
          return;
        }
        if (call?.type === 'krok') {
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(container, visit);
  };

  visitContainer(source, [], []);

  return { tests, storiesFiles: [...new Set(storiesNamespaces.values())] };
};
