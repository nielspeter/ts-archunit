/**
 * The declaration side of plan 0069: what a glob is, and how a set of globs
 * combines, so that "this rule can never match anything" is answerable without
 * running the rule.
 *
 * Nothing here evaluates. Evaluation lives in `glob-diagnosis.ts`, against the
 * path universe; this module only describes.
 */

/**
 * Which string a glob is matched against.
 *
 * This names **the target**, never the API. `SmellBuilder.inFolder()` matches
 * the full file path despite its name (`src/smells/duplicate-bodies.ts`), and
 * exactly one selector in `src/` — `resideInFolder` — matches a directory.
 * Two revisions of the plan's own census got this wrong by reading the method
 * name, and each time reported a vacuous rule as satisfiable.
 *
 * - `file-path`   — the whole absolute path of the file
 * - `parent-dir`  — the immediate parent directory of the file, and only the
 *                   immediate parent: `resideInFolder` tests
 *                   `filePath.substring(0, filePath.lastIndexOf('/'))`
 * - `import-target` — a resolved module path or a bare specifier. Never
 *                   checked against the path universe: `node_modules` is
 *                   outside the project by construction, so checking it would
 *                   fail every correct dependency rule in existence
 * - `specifier`   — a raw module specifier
 * - `literal`     — matched against source text, not a path
 */
export type GlobKind = 'file-path' | 'parent-dir' | 'import-target' | 'specifier' | 'literal'

/**
 * Where in a rule the glob was written, which decides whether being
 * unsatisfiable is a fault.
 *
 * - `selector`  — narrows the subject set. Unsatisfiable ⇒ the rule can never
 *                 have subjects
 * - `discovery` — defines a population (slices, layers, boundary folders).
 *                 Unsatisfiable ⇒ nothing to check
 * - `condition` — asserts something about subjects. Unsatisfiable is
 *                 indistinguishable from an armed tripwire that has not fired
 * - `exclusion` — subtracts. An exclusion matching zero is remedy-optional
 *                 (proposal 006) and never a fault
 */
export type GlobPosition = 'selector' | 'discovery' | 'condition' | 'exclusion'

/**
 * Is a dead glob at this position a **fault**?
 *
 * One owner for a decision that was written twice, inversely, and disagreed —
 * [plan 0080](../../plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md).
 *
 * | site | said | i.e. |
 * | --- | --- | --- |
 * | `diagnose.ts` | skip `exclusion` and `condition` | selector **and discovery** are faults |
 * | `terminal-builder.ts` | skip anything but `selector` | only selector is |
 *
 * So `doctor` reported a dead `discovery` glob and the check that gates the build
 * did not — the divergence bug 0040's silence half is made of. Two hand-maintained
 * inverse lists that must agree is the shape ADR-008 rule 5 keeps charging this
 * project for; a shared predicate is the whole fix.
 *
 * **`selector` and `discovery` are faults.** Both name what a rule will judge, so
 * a dead one means the rule judges nothing.
 *
 * **`condition` and `exclusion` are not.** A condition glob is an assertion
 * *about* the subjects — `onlyImportFrom('**\/domain/**')` matching nothing is a
 * satisfied rule, not a broken one (bug 0014) — and an exclusion glob matching
 * nothing is an unused exemption, which `.excluding()` reports on its own terms.
 *
 * ## A `switch`, not an `||`, and that is the point
 *
 * It shipped as `position === 'selector' || position === 'discovery'` — an
 * allow-list with no exhaustiveness check. Review measured the consequence: a
 * **fifth** `GlobPosition` added to the union above compiles clean and leaves the
 * whole suite green, silently a non-fault in all three consumers. A dead glob
 * written at it would be invisible in `doctor` *and* in the build — which is the
 * original divergence's failure direction, one level up, in the predicate that
 * exists to remove it.
 *
 * The predicate's own test enumerates the four known values, which is a
 * restatement of the implementation and structurally cannot cover a fifth. The
 * `never` assignment below can, and it fails at compile time rather than at
 * review time.
 */
export function isFaultPosition(position: GlobPosition): boolean {
  switch (position) {
    case 'selector':
    case 'discovery':
      return true
    case 'condition':
    case 'exclusion':
      return false
    default: {
      // A new position must say which it is. Deciding by default is how the two
      // inverse lists came to disagree in the first place.
      const exhaustive: never = position
      return exhaustive
    }
  }
}

/**
 * Which set of paths the glob is written against.
 *
 * **This affects the verdict**, and the earlier claim here that it was
 * message-only is withdrawn. Satisfiability is still taken against the union
 * of the views for the glob's `kind`, but the ANCHOR check consults `base`:
 * an unanchored glob can never match an absolute path, so for
 * `base: 'absolute'` it is dead however the project is shaped — while for a
 * base whose entry point rewrites or relativises the glob, an unanchored
 * spelling is correct and telling the author to anchor it would break a
 * working rule.
 *
 * The union alone was tried and was a false green on the commonest real
 * mistake: the tsconfig-relative view accepts `'src/domain/**'`, which
 * `resideInFolder` can never match. Unanchored globs are the entire subject of
 * the 0.18.1 release, so a design that quietly calls them satisfiable defeats
 * its own purpose.
 *
 * So a mis-declared `base` CAN cause a red build. It is set beside `kind` by
 * the same code, from what the entry point does rather than from intent, and
 * `tests/core/glob-declaration.test.ts` asserts the equivalent spellings agree.
 */
export type GlobBase = 'absolute' | 'tsconfig-relative' | 'normalized'

/**
 * A glob as a predicate, condition or builder declares it.
 *
 * This is the author-facing half. `position` and `origin` are deliberately
 * absent: the code that mints a site — inside `resideInFolder()`, several
 * frames below any builder — cannot know either, and the builder stamps them
 * on. Exposing them here would also let a rule author write
 * `position: 'exclusion'` and permanently exempt their own predicate from the
 * check, with no signal that they had.
 */
export interface DeclaredGlob {
  readonly glob: string
  readonly kind: GlobKind
  /** Defaults to `'positive'`. A negative site can never be dead — see `GlobNode`. */
  readonly polarity?: 'positive' | 'negative'
  /**
   * Defaults to `'absolute'`. **Affects the verdict** — see `GlobBase`. An
   * unanchored glob is dead for `'absolute'` and correct for a base whose
   * entry point rewrites or relativises it.
   */
  readonly base?: GlobBase
}

/** A declared glob after a builder has stamped on what only it knows. */
export type GlobSite = DeclaredGlob & {
  readonly position: GlobPosition
  /** For the message: `resideInFolder("**\/src/x/**") in rule "adr005/no-any"`. */
  readonly origin: string
}

/**
 * A predicate or condition that declares no globs.
 *
 * Retained in the tree rather than dropped, and never dead. Dropping is safe
 * under `all` — `some(dead)` is monotone — but `not()` turns an `all` into an
 * `any`, and under `any` dropping an opaque child is what makes
 * `or(deadGlob, exportSymbolNamed('Foo'))` red a working rule. Since most
 * predicates declare no globs, that would have been the commonest failure of
 * the whole mechanism.
 *
 * Retaining it costs no detection, removes the need for a separate `or()`
 * propagation rule, and makes an empty node unreachable — which matters
 * because `[].every()` is `true` and would otherwise fault a rule containing
 * no globs at all. Verified exhaustively by
 * `spikes/0069-tree-model-check.mjs`: 0 false reds and 0 missed emptiness
 * across every expression of at most three combinator nodes.
 */
export interface OpaqueGlob {
  readonly opaque: true
}

/** A leaf of a glob tree: a declaration of some kind, or an opaque input. */
export type GlobLeaf<L> = L | OpaqueGlob

/**
 * How a set of globs combines.
 *
 * - `all` — every child must match for the whole to match, so the whole is
 *   dead if **any** child is dead. `and()`.
 * - `any` — one child matching is enough, so the whole is dead only if
 *   **every** child is dead. `or()`, a variadic predicate
 *   (`importFrom(...globs)` is `matchers.some`), repeated `.inFolder()` calls.
 *
 * A preset's option list is **not** an `any` node: both shipped presets fan
 * out one rule per glob (`src/presets/layered.ts`, `src/presets/boundaries.ts`),
 * so one dead layer glob is one vacuous rule, and `any` would say "no fault
 * unless every layer is dead" — a false green inside a preset. Each generated
 * builder declares its own root instead.
 */
export interface GlobTree<L> {
  readonly op: 'any' | 'all'
  readonly children: readonly (GlobTree<L> | GlobLeaf<L>)[]
}

/**
 * What a predicate, condition or builder method declares.
 *
 * Its leaves are `DeclaredGlob`, which has no `position` and no `origin`, so
 * a rule author **cannot** express "this is an exclusion" and thereby exempt
 * their own predicate from the check. That is a type-level guarantee rather
 * than a convention.
 */
export type DeclaredGlobs = GlobTree<DeclaredGlob>

/** A declared tree after a builder has stamped position and origin onto it. */
export type GlobNode = GlobTree<GlobSite>

/** How many real declarations a tree holds. Opaque leaves do not count. */
export function countDeclaredGlobs<L extends object>(tree: GlobTree<L>): number {
  let total = 0
  for (const child of tree.children) {
    if (isGlobNode(child)) total += countDeclaredGlobs(child)
    else if (!isOpaqueGlob(child)) total++
  }
  return total
}

/** Narrow a tree position to an interior node. */
export function isGlobNode<L extends object>(
  value: GlobTree<L> | GlobLeaf<L>,
): value is GlobTree<L> {
  return 'op' in value
}

/** Narrow a leaf to the opaque case. */
export function isOpaqueGlob<L extends object>(
  value: GlobTree<L> | GlobLeaf<L>,
): value is OpaqueGlob {
  return 'opaque' in value
}

/**
 * A variadic declaration: any one of these globs matching is enough.
 *
 * `importFrom(...globs)` is `matchers.some`, so the set is dead only when
 * every glob in it is — which is exactly `any`. Getting this wrong in the
 * other direction is what the 0.18.1 withdrawal was.
 */
export function globAnyOf(
  globs: readonly string[],
  kind: GlobKind,
  base?: GlobBase,
): DeclaredGlobs {
  return { op: 'any', children: globs.map((glob) => ({ glob, kind, base })) }
}

/** A single declaration as a one-element `any` tree. */
export function globNode<L extends object>(leaf: L): GlobTree<L> {
  return { op: 'any', children: [leaf] }
}

/**
 * Stamp a declared tree with what only the builder knows.
 *
 * `origin` is a function of the declaration so each site can name itself —
 * `resideInFolder("**\/src/x/**")` — rather than every site in one predicate
 * sharing a single label.
 */
export function stampGlobs(
  declared: DeclaredGlobs,
  position: GlobPosition,
  origin: (glob: DeclaredGlob) => string,
): GlobNode {
  return {
    op: declared.op,
    children: declared.children.map((child) => {
      if (isGlobNode(child)) return stampGlobs(child, position, origin)
      if (isOpaqueGlob(child)) return child
      return { ...child, position, origin: origin(child) }
    }),
  }
}

/**
 * Negate a glob tree: invert `op` at every node **and** flip `polarity` at
 * every site.
 *
 * A polarity flip alone is not enough, and the shortfall is not exotic — it is
 * reachable through public exports, since `and()` returns a `Predicate<T>` and
 * `not()` takes one. `not(and(live, not(dead)))` selects a non-empty set and
 * would be reported dead; `not(or(live, not(dead)))` selects nothing and would
 * be missed. Inverting `op` as well is the standard negation-normal-form
 * push-down and fixes both directions, leaving every simpler case unchanged:
 * `not(not(dead))` still faults, `not(and(a, b))` still does not.
 */
export function negateGlobs<L extends DeclaredGlob>(tree: GlobTree<L>): GlobTree<L> {
  return {
    op: tree.op === 'all' ? 'any' : 'all',
    children: tree.children.map((child) =>
      isGlobNode(child) ? negateGlobs(child) : negateLeaf(child),
    ),
  }
}

function negateLeaf<L extends DeclaredGlob>(leaf: GlobLeaf<L>): GlobLeaf<L> {
  if (isOpaqueGlob(leaf)) return leaf
  return {
    ...leaf,
    polarity: (leaf.polarity ?? 'positive') === 'positive' ? 'negative' : 'positive',
  }
}

/**
 * Combine inputs into one node, treating a missing declaration as opaque.
 *
 * Every input contributes exactly one child, so the arity of the node always
 * matches the arity of the combinator — which is what keeps `negateGlobs`
 * sound and empty nodes unreachable.
 */
export function combineGlobs<L extends object>(
  op: 'any' | 'all',
  inputs: readonly (GlobTree<L> | undefined)[],
): GlobTree<L> {
  return {
    op,
    children: inputs.map((input) => input ?? OPAQUE),
  }
}

const OPAQUE: OpaqueGlob = { opaque: true }
