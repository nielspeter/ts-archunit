import type { RuleDescription } from '../core/rule-description.js'
import picomatch from 'picomatch'
import path from 'node:path'
import type { SourceFile } from 'ts-morph'
import { selectionMemo } from '../core/selection-memo.js'
import { SmellBuilder } from './smell-builder.js'
import { collectFunctions } from '../models/arch-function.js'
import { searchFunctionBody } from '../helpers/body-traversal.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchProject } from '../core/project.js'

/** Majority threshold — flag when >= 60% of siblings match but a file doesn't. */
const MAJORITY_THRESHOLD = 0.6

/** Test file patterns for ignoreTests(). */
const TEST_PATTERNS = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']

const selectionOf = selectionMemo<[string, SourceFile[]]>()

/**
 * 0102: diagnostic-first. N ships false (diagnose previews, check passes); the
 * flip release sets true (check fails). Not a warn-first migration — a
 * warning is invisible in a test run (bug 0024) and trains suppression.
 * The N+1 flip is tracked in plan 0105.
 */
const INERT_FINDING_EMIT = false

/** The corpus split for one pattern — the single type both surfaces share. */
type Assessment = {
  matching: number
  total: number
  canFireSoon: boolean
  folders: { folder: string; matching: SourceFile[]; nonMatching: SourceFile[] }[]
}

export class InconsistentSiblingsBuilder extends SmellBuilder {
  private _pattern?: ExpressionMatcher

  constructor(project: ArchProject) {
    super(project)
  }

  /** The pattern that most siblings should follow. */
  forPattern(matcher: ExpressionMatcher): this {
    const next = this.copy()
    next._pattern = matcher
    return next
  }

  /** Check if a source file contains any function matching the pattern. */
  private fileMatchesPattern(sf: SourceFile, pattern: ExpressionMatcher): boolean {
    // Detectors scan for a property of the code, not a user-declared subject
    // set, so they always include object-literal functions. `functions()`
    // keeps that opt-in because widening a selector silently changes every
    // existing rule; a detector has no such contract to break, and a
    // duplicated arrow under an object key — a resolver, a route handler, a
    // reducer case — is exactly the copy-paste rot this exists to find.
    for (const fn of collectFunctions(sf, { includeObjectLiteralFunctions: true })) {
      const body = fn.getBody()
      if (!body) continue

      const lineCount = body.getText().split('\n').length
      if (lineCount < this._minLines) continue

      if (searchFunctionBody(fn, pattern).found) return true
    }
    return false
  }

  /**
   * Sibling files in folders large enough to be compared — plan 0096, and the
   * ONE method both readers call.
   *
   * The `>= 2` threshold lives HERE rather than in `detect()`'s loop, which is
   * what makes this a shared derivation instead of two that agree by luck.
   * Filtering before the caller's sort is safe: `groupFilesByFolder()` returns
   * insertion order and `detect()` sorts by folder name, a total order, so
   * removing entries cannot reorder the survivors.
   */
  private selected(): [string, SourceFile[]][] {
    return selectionOf(this, () =>
      [...this.groupFilesByFolder().entries()].filter(([, files]) => files.length >= 2),
    )
  }

  /**
   * Units this detector examined — plan 0096: sibling files in folders large
   * enough to be compared.
   *
   * Counted in units ITERATED, never in pattern matches: a tripwire that
   * examines every sibling and matches none has non-empty evidence, which is the
   * 0.34.0 carve-out this must not break.
   */
  examinedUnits(): number {
    return this.selected().reduce((total, [, files]) => total + files.length, 0)
  }

  /** Partition files into matching and non-matching based on the pattern. */
  private partitionByPattern(
    files: SourceFile[],
    pattern: ExpressionMatcher,
  ): { matching: SourceFile[]; nonMatching: SourceFile[] } {
    const matching: SourceFile[] = []
    const nonMatching: SourceFile[] = []
    for (const sf of files) {
      if (this.fileMatchesPattern(sf, pattern)) {
        matching.push(sf)
      } else {
        nonMatching.push(sf)
      }
    }
    return { matching, nonMatching }
  }

  /**
   * Pure recomputation of the corpus split — never accumulated on `this`. It is
   * the SINGLE source the finding's message, the gate, and the diagnostic preview
   * all read, so the preview and the finding cannot diverge, and calling it twice
   * cannot double-count (each call recomputes). Mirrors `examinedUnits()`: one
   * derivation, not an instance field.
   *
   * `canFireSoon` is true when any folder is at or within ONE edit of a majority —
   * such a folder can fire, so it is not inert even though it does not fire today.
   *
   * The GUARD lives here, not at the emit site. A preview read through this
   * accessor can then never report on a rule that can fire: a healthy control
   * (majority present, `editsToMajority <= 1`) gets `canFireSoon = true`, and the
   * hook below returns the empty string for it. The check-time emit and the
   * diagnostic preview share this one predicate by construction.
   */
  private inertAssessment(pattern: ExpressionMatcher): Assessment {
    let matching = 0
    let total = 0
    let canFireSoon = false
    const folders: Assessment['folders'] = []
    for (const [folder, files] of this.selected()) {
      const { matching: m, nonMatching } = this.partitionByPattern(files, pattern)
      const t = m.length + nonMatching.length
      // Unreachable today: selected() already filters to files.length >= 2
      // and partitionByPattern drops nothing, so t always equals a folder's
      // file count and is never 0 here. Kept as future-proofing against a
      // change to selected(), not a live branch.
      if (t === 0) continue
      matching += m.length
      total += t
      folders.push({ folder, matching: m, nonMatching })
      // A folder at or within one edit of a majority is a live tripwire. Latched
      // regardless of nonMatching===0: a fully-conforming majority folder is one
      // divergent file away from firing, so it must suppress the inert finding.
      //
      // KNOWN LIMIT, conservative direction only (review: architect): for t=2,
      // m=1 this reads editsToMajority = ceil(1.2) - 1 = 1 <= 1 and latches —
      // but the only available edit (adopting the second file) yields m=2,
      // nonMatching=0, which still cannot fire; a THIRD file would be needed.
      // A two-file folder with one match (e.g. an index.ts plus one impl) is
      // an ordinary shape, so this latch is reachable in practice, not a
      // corner case. Never a false POSITIVE (a rule that can genuinely fire
      // soon is never reported inert) — only a false latch that keeps a
      // genuinely-inert corpus silent, and it is OR'd across every folder in
      // scope, so one such folder anywhere suppresses the whole rule's inert
      // finding. Not fixed here: the arithmetic is a documented approximation
      // of "close to firing", not a precise one, and narrowing it is a
      // separate, non-urgent piece of work.
      const editsToMajority = Math.ceil(MAJORITY_THRESHOLD * t) - m.length
      if (editsToMajority <= 1) canFireSoon = true
    }
    return { matching, total, canFireSoon, folders }
  }

  /** Build violations for non-matching files in a folder where the majority matches. */
  private buildFolderViolations(
    folder: string,
    matching: SourceFile[],
    nonMatching: SourceFile[],
    ruleDescription: string,
    patternDesc: string,
  ): ArchViolation[] {
    const total = matching.length + nonMatching.length
    const violations: ArchViolation[] = []
    for (const sf of nonMatching) {
      violations.push({
        rule: ruleDescription,
        element: sf.getBaseName(),
        file: sf.getFilePath(),
        line: 1,
        message:
          `${String(matching.length)} of ${String(total)} files in ${folder} use ${patternDesc}, ` +
          `but ${sf.getBaseName()} does not`,
        // The message states the population ("3 of 5"), which is a fact about
        // the folder rather than about this file: adding one unrelated sibling
        // rewrites it, and every already-accepted finding in the folder loses
        // its identity. The finding itself is "this file, in this folder, does
        // not follow this pattern" — that, and only that, is the identity.
        identity: `inconsistent-sibling::${sf.getFilePath()}::${patternDesc}`,
        because: this._reason,
      })
    }
    return violations
  }

  override assertsSomething(): boolean {
    return this._pattern !== undefined
  }

  /**
   * Named by id or by what the detector checks — the inherited version says
   * 'unnamed'. Uses `describe()` rather than a call-site locator for the same
   * reason as `SliceRuleBuilder`: `explain --format agent` reads this field.
   */
  /**
   * This detector counts sibling FILES, not function bodies — plan 0099.
   *
   * It inherited `SmellBuilder`'s noun while `examinedUnits()` sums
   * `files.length`, so the message read "examined 0 function bodies" for a
   * file-counting detector: the category error this plan exists to remove, in the
   * family sitting directly under the override.
   */
  protected override examinedUnitNoun(): string {
    return 'sibling files'
  }

  override describeRule(): RuleDescription {
    return {
      ...super.describeRule(),
      rule: this._metadata?.id ?? this.describe(),
    }
  }

  override assertionAdvice(): string {
    return (
      'this detector has no pattern, so it detects nothing and can never fail. Add ' +
      '.forPattern(...), or use smells.duplicateBodies() for patternless duplicate detection.'
    )
  }

  protected detect(): ArchViolation[] {
    // Unreachable at runtime as of 0.23.0: the assertion gate reports a
    // patternless detector as a configuration finding before `detect()` is
    // called (bug 0019), so `_pattern` is always set by the time we get here.
    // The branch stays only because strict null checks need the narrowing —
    // hence the local, which the rest of the method reads instead of the field.
    // Do not treat it as the answer to "what happens with no pattern": the loud
    // answer is the gate, and if this ever returns `[]` again the gate is gone.
    const pattern = this._pattern
    if (!pattern) return []

    const ruleDescription = this.describe()
    const patternDesc = pattern.description
    const violations: ArchViolation[] = []

    // ONE assessment — the single partition walk. It returns the aggregate
    // (matching/total/canFireSoon) AND the per-folder partitions; detect() uses
    // both. Do NOT call partitionByPattern again below: the searchFunctionBody
    // walk is the dominant cost and must run once per check().
    const a = this.inertAssessment(pattern)

    // Preserves groupByFolder()'s existing violation-ordering contract for
    // THIS family (review: testing — an earlier version of this comment cited
    // tests/integration/coverage-gaps.test.ts's "groupByFolder produces
    // violations sorted by directory" row, which covers duplicateBodies and
    // asserts only `.toThrow()`, not order, for either family; the real guard
    // for inconsistentSiblings is
    // "groupByFolder() sorts violations across folders" below). Sorting the
    // returned folder array is O(k log k) on folder COUNT, not a second AST
    // walk: inertAssessment()'s searchFunctionBody pass already ran once,
    // above, and this sort touches only its already-computed output.
    const folders = this._groupByFolder
      ? [...a.folders].sort((x, y) => x.folder.localeCompare(y.folder))
      : a.folders

    for (const { folder, matching, nonMatching } of folders) {
      const total = matching.length + nonMatching.length
      if (matching.length / total < MAJORITY_THRESHOLD) continue
      if (nonMatching.length === 0) continue

      violations.push(
        ...this.buildFolderViolations(folder, matching, nonMatching, ruleDescription, patternDesc),
      )
    }

    // The adequacy floor, VERSION-GATED and SHARED-SOURCE. NOT a floor extension —
    // the real floor fires at violations===0 && examined===0; this fires at
    // violations===0 && examined>0 && no folder is within one edit of a majority.
    // The guard lives in the shared advice function, not here: the emit and the
    // diagnostic preview are the same derivation, so the preview can never report
    // on a rule that can fire. detect() passes the assessment it ALREADY computed
    // (no second partition walk); the empty-string return means "not inert".
    const advice = this.inertAdviceFor(a)
    if (violations.length === 0 && this.inertEmitEnabled() && advice !== '') {
      return [this.inertViolation(advice), ...violations]
    }
    return violations
  }

  /**
   * The `DiagnosableRule` hook — public, no-arg, exactly the shape the
   * interface requires. Recomputes `inertAssessment()` fresh, so `diagnose()`
   * on a builder that never ran `check()` still gets truthful numbers.
   */
  inertAdvice(): string {
    const pattern = this._pattern
    if (!pattern) return ''
    return this.inertAdviceFor(this.inertAssessment(pattern))
  }

  /**
   * THE single derivation for both surfaces, and the guard. Returns the empty
   * string unless the rule is genuinely inert (`matching > 0 && !canFireSoon &&
   * !declaresEmpty()`), so a healthy control (majority present, within one edit
   * of one, or declared empty) gets `''` and diagnose() reports nothing for it.
   * Both `inertAdvice()` above and `detect()`'s emit call this with an
   * `Assessment` — the SAME guard and the SAME message either way, so the
   * preview and the finding cannot diverge.
   *
   * `!this.declaresEmpty()` lives HERE, not only in `inertEmitEnabled()` (review:
   * architect) — a declared-empty rule reports its expiry, not the inert finding,
   * on BOTH surfaces, so `diagnose()`'s preview and `check()`'s eventual failure
   * name the same cause for the same rule state. Before this fix the two clauses
   * were split across two functions and only the emit path read the declaration,
   * so a rule carrying `.expectEmpty()` could preview one cause via `diagnose()`
   * and fail with a different one via `check()` — the exact drift this shared-
   * derivation design exists to make impossible "by construction".
   */
  private inertAdviceFor(a: Assessment): string {
    if (a.matching === 0 || a.canFireSoon || this.declaresEmpty()) return '' // the GUARD lives here
    return this.inertMessage(a, this._pattern?.description ?? 'unknown pattern')
  }

  /** Single source of the inert message. Pure — takes the assessment, returns text. */
  private inertMessage(a: { matching: number; total: number }, patternDesc: string): string {
    return (
      `This detector examined ${String(a.total)} sibling files, but only ${String(a.matching)} of them ` +
      `hold the pattern '${patternDesc}', and no folder is within an edit of a majority — so as written it ` +
      `cannot produce a finding today. It reports a file that diverges from what its siblings do; with no ` +
      `majority reachable by adopting files, there is no divergence to report. ` +
      `If this rule asserts a convention the codebase is still adopting, replace it with ` +
      `correspondence().side(...).beComplete(), which fails the day a file falls short — until adoption is ` +
      `complete, so expect that red. If the intent is to police divergence rather than the convention itself, ` +
      `widen the folder so a majority forms, or choose a pattern the sibling files already share.`
    )
  }

  private inertViolation(advice: string): ArchViolation {
    return {
      rule: this.describe(),
      ruleId: this._metadata?.id,
      element: this.inertElement(),
      file: '',
      line: 0,
      message: advice,
      // Its own remedy, never the author's (bug 0021): the message IS the remedy.
      suggestion: advice,
      because: this._reason,
      // Adequacy finding: the rule enforces nothing, which is not a severity the
      // author grades (ADR-008 rule 1). Config-level: no file to attribute, so it
      // must survive diff/baseline or the guard re-greens under standard CI.
      bypassFilters: true,
      // No `identity` set, deliberately, NOT an oversight (review: architect
      // flagged the gap; this is why it stays a gap): `bypassFilters: true`
      // means baseline/diff never read one today, so setting one buys nothing
      // yet — and `message` embeds the population count ("examined N... only
      // M of them"), which ADR-008 rule 4 forbids putting in an identity (a
      // count rots). If `bypassFilters` is ever relaxed for this family, an
      // `identity` has to be added HERE, population-free, before that ships —
      // this comment is the tripwire for that future change, not a promise
      // the coupling is already handled.
    }
  }

  /**
   * Dedupe key for the inert finding. `dedupeConfigFindings` keys on
   * `${file} ${ruleId ?? rule} ${element}`; `file` is always `''` here and
   * `rule`/`ruleId` fall back to `describe()`, which is scope-blind (reads
   * `_pattern` only). So without a scope-aware `element`, two same-pattern/
   * different-scope inert detectors with no explicit `.rule({id})` would
   * collapse into one finding under `checkAll`.
   *
   * Folds in every field `groupFilesByFolder()`/`fileMatchesPattern()` read to
   * decide what's examined — `_folders`, `_ignorePaths`, `_ignoreTests`,
   * `_minLines` — sorted so option order cannot split one semantic scope into
   * two keys. Two rules with identical scope correctly collapse to one finding
   * (one edit fixes both); two rules differing in ANY of these stay distinct.
   */
  private inertElement(): string {
    const patternDesc = this._pattern?.description ?? 'unknown pattern'
    const folders = [...this._folders].sort().join('|')
    const ignorePaths = [...this._ignorePaths].sort().join('|')
    return `inert:${patternDesc}:${folders}:${ignorePaths}:${String(this._ignoreTests)}:${String(this._minLines)}`
  }

  /**
   * The pure version gate — nothing else. The `_expectEmpty` precedence
   * (`!this.declaresEmpty()`) moved into `inertAdviceFor()` above, so it applies
   * identically to `diagnose()`'s preview and to this emit path; this function's
   * only job is "has the N+1 release happened yet."
   *
   * `INERT_FINDING_EMIT` is deliberately a bare, non-exported module `const` —
   * not an env var, constructor option, or per-project override. The
   * `bypassFilters: true` / unsuppressable design above depends on there being
   * no configuration surface a future contributor could "helpfully" expose,
   * which would undermine it silently.
   *
   * `protected`, not `private` — a test-only subclass overrides this to exercise
   * the emit path (`inertViolation()`, `inertElement()`, the `detect()` branch
   * that pushes them) before the N+1 flip ships, so that path is not shipped
   * with zero test coverage merely because the real gate is off today (review:
   * testing). See `tests/smells/inconsistent-siblings.test.ts`'s
   * `EmittingSiblings` subclass.
   */
  protected inertEmitEnabled(): boolean {
    return INERT_FINDING_EMIT
  }

  protected describe(): string {
    const pattern = this._pattern?.description ?? 'unknown pattern'
    return `Sibling files should consistently use ${pattern}`
  }

  /** Group source files by parent folder, applying all filters. */
  private groupFilesByFolder(): Map<string, SourceFile[]> {
    const sourceFiles = this.project.getSourceFiles()
    const folderMatchers = this._folders.map((g) => picomatch(g))
    const ignoreMatchers = this._ignorePaths.map((g) => picomatch(g))
    const testMatchers = this._ignoreTests ? TEST_PATTERNS.map((g) => picomatch(g)) : []

    const groups = new Map<string, SourceFile[]>()

    for (const sf of sourceFiles) {
      const filePath = sf.getFilePath()

      // Folder filter: if folders specified, file must match at least one
      if (folderMatchers.length > 0 && !folderMatchers.some((m) => m(filePath))) {
        continue
      }

      // Ignore paths filter
      if (ignoreMatchers.some((m) => m(filePath))) {
        continue
      }

      // Test file filter
      if (testMatchers.some((m) => m(filePath))) {
        continue
      }

      const folder = path.dirname(filePath)
      const existing = groups.get(folder)
      if (existing) {
        existing.push(sf)
      } else {
        groups.set(folder, [sf])
      }
    }

    return groups
  }
}
