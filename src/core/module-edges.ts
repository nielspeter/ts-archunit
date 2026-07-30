import { Node, SyntaxKind } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { isTypeOnlyImport, isTypeOnlyReExport } from './import-options.js'

/**
 * One definition of "a module edge", for every condition that needs one.
 *
 * [Bug 0022](../../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md):
 * `src/conditions/dependency.ts` collected edges from `sf.getImportDeclarations()`
 * at five sites — static `import` statements and nothing else — while the reverse
 * graph indexed static imports, re-exports **and** dynamic imports. So
 * `onlyBeImportedVia('…')` saw a re-export as an import and `notImportFrom('…')`
 * did not, and `export { x } from './banned.js'` crossed every banned edge
 * unflagged.
 *
 * `SourceFile.getImportStringLiterals()` returns one literal per module
 * specifier across every edge-carrying form, from the binder's cached
 * `compilerNode.imports` rather than a descendant walk. Measured over 20 forms;
 * the table lives in plan 0071 §1 and the fixture that pins it is
 * `tests/fixtures/module-edge-forms/`.
 *
 * **Two classification traps**, both of which would mark a *runtime* dependency
 * as erased — and both are why `kind` is a five-member union rather than four:
 *
 * - `import x = require('s')` has parent `ExternalModuleReference`. A 4-way
 *   branch ending in `else → 'type-expression'` gives it `typeOnly: true`,
 *   exempt under `ignoreTypeImports`. Common in hand-written `.d.ts`.
 * - `require('s')` in `.js` under `allowJs` has parent `CallExpression`, the same
 *   as `import('s')`. `getExpression().getKind() === ImportKeyword` is the only
 *   discriminator, as `reverse-dependency.ts` already knew.
 *
 * **Nothing here narrows the literal.** `getImportStringLiterals()` is declared
 * `StringLiteral[]` and ``import(`./x.js`)`` yields a
 * `NoSubstitutionTemplateLiteral`, for which `Node.isStringLiteral()` is
 * **false**. ADR-005 bars the `as` that would re-narrow it, so an implementer
 * narrowing defensively silently drops the edge and `tsc` says nothing.
 * `getLiteralText()` typechecks and is correct for both.
 */
export type ModuleEdgeKind = 'import' | 'reexport' | 'dynamic' | 'type-expression' | 'require'

/** One module specifier leaving one file. */
export interface ModuleEdge {
  readonly kind: ModuleEdgeKind
  /** The specifier as written. */
  readonly specifier: string
  /** Resolved absolute path, when the compiler resolved it. */
  readonly resolvedPath: string | undefined
  /**
   * 1-based line of the **statement** carrying the edge.
   *
   * Equals `decl.getStartLineNumber()` for `kind === 'import'`, which
   * `tests/core/module-edges-corpus.test.ts` asserts across the whole repo: 88
   * of this repo's 1751 import declarations (5.0%) put the specifier on a
   * different line from the keyword, so keying off the literal would move 5% of
   * reported lines. Not a baseline concern — `hashViolation` never sees the line
   * — but it drives the code frame and the GitHub annotation position.
   *
   * The same gap exists for every other kind, which is why the fixture carries a
   * multi-line form of each: a multi-line `export { … } from` and a multi-line
   * `import(…)` both move too, and a line taken from the literal passes every
   * single-line test.
   */
  readonly line: number
  /** Erased at compile time, so no runtime dependency. Per-kind; see below. */
  readonly typeOnly: boolean
  /**
   * Named bindings crossing the edge.
   *
   * **The name, not the local binding** — and which one differs per kind:
   *
   * - `reexport`: the **outward** name, `getAliasNode() ?? getName()`. For
   *   `export { INNER as OUTER } from 's'` this is `OUTER`, because that is the
   *   key the re-exporting module's runtime namespace carries, and the runtime
   *   independence guard compares against a runtime namespace. Under the
   *   local-name reading that guard fails on a *correct* implementation.
   * - `import`: the **inward** name, `getName()`. For `import { c as d }` this is
   *   `c` — the name crossing the edge, not the local binding `d`.
   *
   * **Empty for `export *`**, and not because the names are unknowable:
   * `sf.getExportSymbols()` flattens `export *` in a single call, and on a
   * circular pair the compiler and the Node runtime independently agree.
   * Nothing is recursive. It is empty for two other reasons:
   *
   * 1. it cannot separate an erased re-export from a runtime one — `export type
   *    { X } from` and `export { X } from` both come back with
   *    `SymbolFlags.Alias` and a single `ExportSpecifier`, indistinguishable
   *    without `getAliasedSymbol()` per name; and
   * 2. it includes names with no runtime existence — a `declare module
   *    './star-src.js' { export const INJECTED: number }` augmentation anywhere
   *    in the project injects `INJECTED` into the star target's exports.
   *
   * (`symbol.getExports()` does **not** flatten; it hands back a synthetic
   * `__export` member. The obvious call gives the unflattened view.)
   *
   * **`export * as NS from 's'` is not a star for this purpose**: it contributes
   * exactly one name, `NS`, statically, with no recursion. `isNamespaceExport()`
   * returns **true for both** star forms — measured — so `getNamespaceExport()`
   * is the only discriminator.
   *
   * Also empty for `dynamic`, `require`, `type-expression`, and for a default or
   * namespace `import` binding (`import D from 's'`, `import * as NS from 's'`),
   * which cross an edge under a name the specifier list does not carry.
   */
  readonly names: readonly string[]
}

/**
 * Every module edge leaving each file, in one call (ADR-007 rule 2).
 *
 * **No cache.** Measured: the full classifying pass is 9.6–17.1ms warm over 471
 * files (1914 edges), and `strictBoundaries`' 1665 file-visits put that at
 * 34–40ms — 25–29% against a 137ms preset baseline. The decision rests on a
 * different number: cold, the first `getSymbol()` on this project costs ~143ms
 * and the incumbent `getModuleSpecifierSourceFile()` costs the same order, so
 * the *incremental* cost of this mechanism over the old one is near-zero and the
 * absolute cost is checker warm-up today's code already pays. If a consumer
 * reports a multiple-slowdown, the fix is a cache of **resolution**, not of the
 * walk.
 *
 * A bulk signature with no single-file sibling, deliberately: `Predicate<T>` is
 * per-element, so the predicate sites call this with one file at a time. That is
 * not the N-crossings problem ADR-007 rule 2 addresses — the walk has no
 * per-project setup, so N calls of one file cost the same total as one call of N
 * files, and the checker warm-up is shared. What it forecloses is batching a
 * resolution cache later, which is recorded rather than hidden.
 */
export function moduleEdges(
  files: readonly SourceFile[],
): ReadonlyMap<string, readonly ModuleEdge[]> {
  const byFile = new Map<string, readonly ModuleEdge[]>()
  for (const sf of files) {
    byFile.set(sf.getFilePath(), edgesOf(sf))
  }
  return byFile
}

/**
 * Every module edge leaving one file, in source order.
 *
 * Exported for the predicate sites, which are per-element by construction and
 * would otherwise build a one-entry `Map` per file just to read it back out.
 */
export function edgesOf(sourceFile: SourceFile): readonly ModuleEdge[] {
  const edges: ModuleEdge[] = []
  for (const literal of sourceFile.getImportStringLiterals()) {
    const parent = literal.getParent()
    if (parent === undefined) continue
    const kind = kindOf(parent)
    if (kind === undefined) continue
    edges.push({
      kind,
      // NOT `getLiteralValue()`, and NOT narrowed: see the module docstring.
      specifier: literal.getLiteralText(),
      resolvedPath: resolve(literal),
      line: statementLine(literal),
      typeOnly: isErased(kind, parent),
      names: namesOf(kind, parent),
      // Sorted by the literal's absolute position so the result is source-ordered
      // and deterministic. The binder's `imports` array puts declaration forms
      // first and expression forms after, regardless of where they appear — so
      // without this, `kind === 'import'` filtered out of an interleaved file
      // would still be source-ordered but `relpath:line` multisets across kinds
      // would not be, and item 8's fixture is exactly such a file.
    })
  }
  return edges.length > 1
    ? [...edges].sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier))
    : edges
}

/** Which of the five forms this literal belongs to, or `undefined` if none. */
function kindOf(parent: Node): ModuleEdgeKind | undefined {
  if (Node.isImportDeclaration(parent)) return 'import'
  if (Node.isExportDeclaration(parent)) return 'reexport'
  if (Node.isLiteralTypeNode(parent)) return 'type-expression'
  if (Node.isExternalModuleReference(parent)) return 'require'
  if (Node.isCallExpression(parent)) {
    // The one place `import()` and `require()` are indistinguishable by parent
    // kind. `reverse-dependency.ts` already discriminates this way.
    return parent.getExpression().getKind() === SyntaxKind.ImportKeyword ? 'dynamic' : 'require'
  }
  return undefined
}

/**
 * The resolved file, via the **specifier's** symbol.
 *
 * One mechanism for all five parent kinds, and it returns the **named** module:
 * `type A = import('./barrel.js').Deep` resolves to `barrel.ts`, where following
 * the *type* symbol instead lands on `impl.ts` and would make
 * `notImportFrom('**\/impl.ts')` fire on a file that never names `impl`.
 *
 * **`getDeclarations()[0]` is not the answer.** With a module augmentation
 * elsewhere in the project, the symbol has two declarations — the `SourceFile`
 * and a `ModuleDeclaration` in the augmenting file — and `[0]` is whichever the
 * compiler merged first. ts-morph's own `ModuleUtils.getReferencedSourceFileFromSymbol`
 * takes `[0]` and bails to `undefined` when it is not a SourceFile, so the other
 * ordering is live in the reference implementation.
 *
 * **How live, measured:** across four shapes — the augmenting file sorting first
 * alphabetically, two augmentations of one module, a `.d.ts` target, and the
 * augmentation written inside the importing file itself — the `SourceFile` came
 * first **every time**. So this is defence against an ordering that is documented
 * in ts-morph's own code and that no arrangement here reproduces, not a fix for an
 * observable defect. A review flagged it as a certain field false positive; that
 * claim did not survive measurement, and saying so is cheaper than a future reader
 * re-deriving it. `find` costs nothing and cannot be wrong, so it stays — but the
 * `[0]` variant passes this repo's suite, which is recorded in
 * `tests/core/module-edges-forms.test.ts` rather than hidden.
 */
function resolve(literal: Node): string | undefined {
  for (const declaration of literal.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isSourceFile(declaration)) return declaration.getFilePath()
  }
  return undefined
}

/**
 * The line of the statement carrying the edge, not of the literal.
 *
 * The nearest `Statement` ancestor, which is the `ImportDeclaration` or
 * `ExportDeclaration` itself for the declaration forms, the `VariableStatement`
 * for `const x = await import(…)`, the `TypeAliasDeclaration` for `type A =
 * import(…).X`, and the `ImportEqualsDeclaration` for `import x = require(…)`.
 * Verified for a multi-line form of each.
 *
 * Falls back to the literal's own line for a literal with no statement ancestor
 * — which the 20-form corpus does not produce, so the fallback is a guard rather
 * than a path.
 */
function statementLine(literal: Node): number {
  const statement = literal.getFirstAncestor((ancestor) => Node.isStatement(ancestor))
  return (statement ?? literal).getStartLineNumber()
}

/**
 * Whether the edge is erased at compile time.
 *
 * Per kind, and the two constants are the classification traps: `require` is
 * **runtime** (an `else → type-expression` branch is what made it look erased)
 * and `dynamic` is always runtime.
 */
function isErased(kind: ModuleEdgeKind, parent: Node): boolean {
  switch (kind) {
    case 'import':
      // Reused unchanged. Its `getDefaultImport()`/`getNamespaceImport()` guards
      // are load-bearing: `import React, { type FC } from 'react'` is a RUNTIME
      // edge, and a formula without them classifies it type-only and skips it
      // under `ignoreTypeImports` — a lost existing finding.
      return Node.isImportDeclaration(parent) ? isTypeOnlyImport(parent) : false
    case 'reexport':
      return Node.isExportDeclaration(parent) ? isTypeOnlyReExport(parent) : false
    case 'type-expression':
      return true
    case 'dynamic':
    case 'require':
      return false
  }
}

/** The names crossing the edge. See {@link ModuleEdge.names} for which name. */
function namesOf(kind: ModuleEdgeKind, parent: Node): readonly string[] {
  if (kind === 'import' && Node.isImportDeclaration(parent)) {
    // Inward names. A default or namespace binding contributes none — it crosses
    // under a name the specifier list does not carry.
    return parent.getNamedImports().map((specifier) => specifier.getName())
  }
  if (kind === 'reexport' && Node.isExportDeclaration(parent)) {
    // `export * as NS` is not a star here: one statically-known name.
    const namespaceExport = parent.getNamespaceExport()
    if (namespaceExport !== undefined) return [namespaceExport.getName()]
    // Outward names, so `export { INNER as OUTER }` reports `OUTER`.
    return parent
      .getNamedExports()
      .map((specifier) => specifier.getAliasNode()?.getText() ?? specifier.getName())
  }
  return []
}

/**
 * How a finding refers to this kind of edge.
 *
 * **An exhaustive `switch`, not a `Record` lookup or a 4-way branch** (plan 0071
 * §4). Measured on a build with `require` unfiltered and no `require` verb: a
 * `Record` lookup emitted the literal string `undefined` into a message —
 * `cjs-consumer.js undefined "…/target.ts" which matches forbidden […]` — and
 * that text is hashed into a baseline. A missing verb must be a compile error;
 * with an explicit `string` return and no fallthrough, adding a sixth
 * `ModuleEdgeKind` breaks the build here.
 *
 * `require` gets a real verb even though no condition reports it (§3). The
 * alternative — throwing, or returning a placeholder — makes a forgotten kind
 * filter produce nonsense instead of a correct sentence, and a correct sentence
 * costs one line.
 *
 * **`import` must stay byte-identical.** Every existing baselined dependency
 * finding hashes its message, so changing this string for `import` silently
 * invalidates them all; the new kinds get distinct verbs precisely so their
 * findings are NOT absorbed by an existing `import` entry for the same module.
 */
export function edgeVerb(kind: ModuleEdgeKind): string {
  switch (kind) {
    case 'import':
      return 'imports'
    case 'reexport':
      return 're-exports'
    case 'dynamic':
      return 'dynamically imports'
    case 'type-expression':
      return 'references the type from'
    case 'require':
      return 'requires'
  }
}

/**
 * How a finding describes a **runtime** edge of this kind, for
 * `onlyHaveTypeImportsFrom`.
 *
 * Separate from {@link edgeVerb} because that condition's sentence needs a noun
 * phrase ("has a value import from") rather than a verb, and because its remedy
 * differs per kind in a way the verb does not capture — see
 * {@link edgeTypeOnlyRemedy}.
 */
export function edgeValuePhrase(kind: ModuleEdgeKind): string {
  switch (kind) {
    case 'import':
      return 'a value import from'
    case 'reexport':
      return 'a runtime re-export of'
    case 'dynamic':
      return 'a dynamic import of'
    case 'type-expression':
      return 'a type reference to'
    case 'require':
      return 'a require call for'
  }
}

/**
 * The remedy for a runtime edge that should be type-only — **per kind, because
 * the remedy differs and one of them has a consequence** (ADR-008 rule 2).
 *
 * `onlyHaveTypeImportsFrom`'s shipped preset says *"Use `import type { X }` so
 * the dependency is erased"*. For an `import` that is complete and local. For a
 * re-export it is not: `export type { X } from` erases the edge **and removes a
 * runtime export consumers may be importing as a value**. The finding still
 * stands — the runtime dependency is real — but a remedy that silently changes
 * what the module publishes is a remedy the reader must be told about.
 *
 * `dynamic` is excluded from that condition entirely for the stronger version of
 * the same reason: there is no remedy at all. You cannot erase an
 * `await import(…)`.
 */
export function edgeTypeOnlyRemedy(kind: ModuleEdgeKind): string {
  switch (kind) {
    case 'import':
      return 'Change it to `import type { … }` so the dependency is erased at compile time.'
    case 'reexport':
      return (
        'Change it to `export type { … } from …`, which erases the dependency but also removes a ' +
        'runtime export — check no consumer imports it as a value. If one does, re-export it from ' +
        'a module this rule permits, or stop re-exporting it here.'
      )
    case 'dynamic':
      return 'A dynamic import cannot be erased. Move the dependency behind an interface this rule permits.'
    case 'type-expression':
      return 'This edge is already erased; no change is needed.'
    case 'require':
      return 'Convert the `require` to an `import type { … }`, or move the dependency.'
  }
}
