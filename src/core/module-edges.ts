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
 * **Used by the reverse graph**, which is the one caller holding a whole file set
 * (`conditions/reverse-dependency.ts`). The four conditions and two predicates
 * call the per-file {@link edgesOf} instead, because `Predicate<T>` is
 * per-element by construction.
 *
 * Having both is not an ADR-007 rule-2 down-payment and this docstring used to
 * claim it was. Measured: the walk has no per-project setup, so N calls of one
 * file cost the same total as one call of N files — 509 single-file calls and one
 * bulk call both land in the same 10.8–16.7ms warm band, and the ~193ms cold cost
 * is checker warm-up that is shared either way. The genuine down-payment is the
 * **ts-morph-free return type**; this signature's value is that it is where a
 * resolution cache would go, and it now has a real caller to hang one on.
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
  const edges: (ModuleEdge & { pos: number })[] = []
  for (const literal of sourceFile.getImportStringLiterals()) {
    const parent = literal.getParent()
    if (parent === undefined) continue
    const kind = kindOf(parent)
    if (kind === undefined) continue
    edges.push({
      // The literal's absolute position, so the sort below is genuine source
      // order. It is dropped from the public shape by the `map` at the end.
      pos: literal.getPos(),
      kind,
      // NOT narrowed: see the module docstring. (`getLiteralValue()` would also
      // work — measured, both accessors return the same cooked text for both
      // literal kinds. The hazard is the narrowing, not the accessor; an earlier
      // version of this comment forbade the sibling accessor on no evidence.)
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
  // Source order, by the literal's absolute position.
  //
  // This used to be `(line, specifier.localeCompare(...))`, which was two defects
  // in one line. The comment claimed "the literal's absolute position" and the
  // code did not use it — measured, `import { Z } from './z.js'; import { A } from
  // './a.js'` on ONE line came back `./a.js, ./z.js` against declaration order
  // `./z.js, ./a.js`, which is one same-line double import away from a false red
  // in the corpus sequence-equality test. And `localeCompare` is ICU/locale
  // sensitive — exactly the machine-dependent ordering `conditions/slice.ts` goes
  // out of its way to eliminate, because a value that differs per machine gives
  // one finding two identities.
  return (edges.length > 1 ? [...edges].sort((a, b) => a.pos - b.pos) : edges).map(
    ({ pos: _pos, ...edge }) => edge,
  )
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
 * The nearest **edge-carrying node** — the declaration, call or import-type that
 * names the module — not the nearest enclosing `Statement`.
 *
 * For the declaration forms the two are the same node, so `import` still equals
 * `decl.getStartLineNumber()` and the corpus equality test holds. They diverge
 * for an expression form nested inside a larger statement, and there the
 * statement is the wrong answer: measured, `register({ handlers: { a: () =>
 * import('./banned.js') } })` spanning lines 3–7 reported **line 3**, pointing the
 * code frame at `register(` rather than at the import, and a class property
 * `loader = import('./x.js')` reported the `ClassDeclaration`'s line because a
 * `PropertyDeclaration` is not a `Statement`. A lazily-loaded route inside an
 * object literal is the commonest real dynamic import, so that was the common
 * case rather than a corner.
 *
 * Falls back to the literal's own line if no carrier is found, which the 20-form
 * corpus does not produce — a guard, not a path.
 */
function statementLine(literal: Node): number {
  const carrier = literal.getFirstAncestor(
    (a) =>
      Node.isImportDeclaration(a) ||
      Node.isExportDeclaration(a) ||
      Node.isImportEqualsDeclaration(a) ||
      Node.isCallExpression(a) ||
      Node.isImportTypeNode(a),
  )
  return (carrier ?? literal).getStartLineNumber()
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
export function edgeTypeOnlyRemedy(edge: Pick<ModuleEdge, 'kind' | 'names'>): string {
  switch (edge.kind) {
    case 'import':
      return 'Change it to `import type { … }` so the dependency is erased at compile time.'
    case 'reexport':
      // A STAR re-export has no names to put in the braces, and telling the reader
      // to write `export type { … } from` there asks them to enumerate the target's
      // entire export list — which an agent will invent rather than look up.
      // `export type * from` is the one-token fix, and `isTypeOnlyReExport`
      // already recognises it.
      if (edge.names.length === 0) {
        return (
          'Change it to `export type * from …`, which erases the dependency. Note this removes the ' +
          'runtime re-exports too — check no consumer imports any of them as a value.'
        )
      }
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

/**
 * The noun for this kind of edge, for `onlyHaveTypeImportsFrom`'s sentence tail.
 *
 * `edgeValuePhrase` was made per-kind and the tail was not, so a re-export read
 * "has a runtime re-export of … which should be a type-only **import**". The two
 * halves have to agree or the sentence contradicts itself.
 */
/**
 * The kinds a **forward** dependency site reports on.
 *
 * One constant, because there were two: `DEPENDENCY_KINDS` in
 * `conditions/dependency.ts` and `PREDICATE_KINDS` in `predicates/module.ts`, whose
 * docstring said "the same set as the conditions … and it has to be" with prose as
 * the only enforcement. `notImportFrom` is one identifier with two definitions
 * chosen by chain position, so a predicate that disagreed with its own condition
 * about what an import is would be this release's Problem statement in miniature.
 *
 * **Exhaustive, not an allowlist filter.** A sixth `ModuleEdgeKind` is a compile
 * error here rather than a kind silently excluded everywhere — that fail-open is the
 * same false green this release closes.
 *
 * `require` is `false`: the kind exists so a 4-way branch cannot mark a CJS runtime
 * dependency as erased, not to enforce CJS. The **reverse** graph counts it, which
 * is the opposite disposition and deliberately so — see `indexEdges`'s reasoning.
 * `onlyHaveTypeImportsFrom` diverges further still (`TYPE_IMPORT_KINDS`), and that
 * one divergence is intentional and documented at its own site.
 */
export const FORWARD_EDGE_KINDS: Record<ModuleEdgeKind, boolean> = {
  import: true,
  reexport: true,
  dynamic: true,
  'type-expression': true,
  require: false,
}

/**
 * Every module edge leaving one file, **lazily and unsorted**.
 *
 * For a caller that only asks "is there any edge matching X". `edgesOf` builds and
 * resolves the whole array before returning, so `edgesOf(sf).some(...)` pays a
 * `getSymbol()` for every literal in the file even when the first one answers the
 * question — on a 100-import file whose first import matches, 100 checker calls
 * where the pre-0.28.0 code made 1.
 *
 * Unsorted, because a `.some()` cannot observe order. Anything that reports a
 * finding must use {@link edgesOf}, whose source ordering is part of its contract.
 */
export function* edgeStream(sourceFile: SourceFile): Generator<ModuleEdge> {
  for (const literal of sourceFile.getImportStringLiterals()) {
    const parent = literal.getParent()
    if (parent === undefined) continue
    const kind = kindOf(parent)
    if (kind === undefined) continue
    yield {
      kind,
      specifier: literal.getLiteralText(),
      resolvedPath: resolve(literal),
      line: statementLine(literal),
      typeOnly: isErased(kind, parent),
      names: namesOf(kind, parent),
    }
  }
}

export function edgeTypeOnlyNoun(kind: ModuleEdgeKind): string {
  switch (kind) {
    case 'import':
    case 'dynamic':
    case 'require':
      return 'import'
    case 'reexport':
      return 're-export'
    case 'type-expression':
      return 'reference'
  }
}
