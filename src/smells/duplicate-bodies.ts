import type { RuleDescription } from '../core/rule-description.js'
import picomatch from 'picomatch'
import path from 'node:path'
import { selectionMemo } from '../core/selection-memo.js'
import { SmellBuilder } from './smell-builder.js'
import { collectFunctions } from '../models/arch-function.js'
import { buildFingerprint, computeSimilarity } from './fingerprint.js'
import type { Fingerprint } from './fingerprint.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchProject } from '../core/project.js'
import type { ArchFunction } from '../models/arch-function.js'
import { relativeToRoot } from '../core/project-relative.js'

/** A function paired with its structural fingerprint. */
interface FingerprintedFunction {
  fn: ArchFunction
  fingerprint: Fingerprint
}

/** Test file patterns for ignoreTests(). */
const TEST_PATTERNS = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']

const selectionOf = selectionMemo<ArchFunction>()

export class DuplicateBodiesBuilder extends SmellBuilder {
  private _minSimilarity = 0.85
  private _minDistinctVocabulary = 8

  constructor(project: ArchProject) {
    super(project)
  }

  /** Set the AST similarity threshold. Default: 0.85. */
  withMinSimilarity(threshold: number): this {
    const next = this.copy()
    next._minSimilarity = threshold
    return next
  }

  /**
   * Minimum count of distinct identifier/literal text either body must carry
   * before a pair is even compared — not raw line count, and not similarity.
   * Two bodies can share a syntactic shape for no reason other than the shape
   * being mandated (a wither, a getter, a boilerplate skeleton); below this
   * threshold a "match" carries no information about what the code actually
   * does. Default: 8 — see plan 0103's Phase 0 triage for how it was chosen.
   * Tune down for a codebase with terser naming than this default assumes;
   * tune up if short, low-vocabulary bodies keep surfacing as noise.
   */
  minDistinctVocabulary(n: number): this {
    const next = this.copy()
    next._minDistinctVocabulary = n
    return next
  }

  /**
   * Named by id or by what the detector checks — the inherited version returns
   * the sentinel `'unnamed'`, and `inconsistent-siblings.ts` already carries this
   * override for that reason.
   *
   * It became load-bearing in plan 0099: the floor makes an over-filtered
   * detector FAIL, and `dedupeConfigFindings` keys on `(file, ruleId ?? rule,
   * element)`. With `file: ''` and `'unnamed'` in both other slots, three
   * genuinely different detectors — different similarity, different
   * `ignorePaths` — collapsed into one finding claiming they were "one option"
   * and "one edit". Two were silently discarded and the survivor said
   * `Rule: unnamed`.
   */
  override describeRule(): RuleDescription {
    return {
      ...super.describeRule(),
      rule: this._metadata?.id ?? this.describe(),
    }
  }

  protected detect(): ArchViolation[] {
    const functions = this.selected()
    const fingerprinted = this.fingerprintAll(functions)
    const pairs = this.findSimilarPairs(fingerprinted)
    return this.buildViolations(pairs)
  }

  protected describe(): string {
    const scope = this._folders.length > 0 ? this._folders.join(', ') : 'all files'
    // EVERY narrowing that distinguishes two instances, not just similarity.
    //
    // This is the `Rule:` line a reader sees, and since plan 0099 it is also the
    // dedupe identity for a detector with no `.rule({ id })`. Rendering only
    // folders and similarity meant three detectors differing in `minLines` shared
    // one key: measured, 3 findings collapsed to 1 claiming they were "one edit",
    // and fixing the surviving threshold left the other two dead and green.
    const filters = [
      `minLines >= ${String(this._minLines)}`,
      `minDistinctVocabulary >= ${String(this._minDistinctVocabulary)}`,
    ]
    if (this._ignorePaths.length > 0) filters.push(`ignoring ${this._ignorePaths.join(', ')}`)
    if (this._ignoreTests) filters.push('ignoring tests')
    return (
      `No duplicate function bodies in ${scope} ` +
      `(similarity >= ${String(this._minSimilarity)}, ${filters.join(', ')})`
    )
  }

  /** Check if a file path passes all glob-based filters. */
  private passesFileFilters(
    filePath: string,
    folderMatchers: picomatch.Matcher[],
    ignoreMatchers: picomatch.Matcher[],
    testMatchers: picomatch.Matcher[],
    fromRoot?: string,
  ): boolean {
    // Both forms, for every set — bug 0036. A project-relative `inFolder()` or
    // `ignorePaths()` glob could never match an absolute path.
    const hits = (ms: picomatch.Matcher[]): boolean =>
      ms.some((m) => m(filePath)) || (fromRoot !== undefined && ms.some((m) => m(fromRoot)))
    if (folderMatchers.length > 0 && !hits(folderMatchers)) return false
    if (hits(ignoreMatchers)) return false
    if (hits(testMatchers)) return false
    return true
  }

  /** Check if a function body meets the minimum line count. */
  private meetsMinLines(fn: ArchFunction): boolean {
    const body = fn.getBody()
    if (!body) return false
    const lineCount = body.getText().split('\n').length
    return lineCount >= this._minLines
  }

  /** Collect all functions matching folder/path/test filters. */
  /**
   * Bodies entering pairwise comparison — plan 0096, and the ONE method both
   * readers call.
   *
   * The seam is AFTER `minLines` and the path filters: a project can load 300
   * files while every body sits under the threshold, and the count that notices
   * has to be taken where the comparison receives its input, not where the files
   * were read.
   *
   * No fingerprinting to count. `meetsMinLines` already returns false for a
   * bodyless function, so `fingerprintAll(xs).length === xs.length` **always** —
   * fingerprinting to answer "is it zero" is a full AST pass of dead work on
   * what becomes the hot path of every consumer's `diagnose()` call.
   */
  private selected(): ArchFunction[] {
    return selectionOf(this, () => this.collectFilteredFunctions())
  }

  /** Units this detector examined — plan 0096. */
  examinedUnits(): number {
    return this.selected().length
  }

  private collectFilteredFunctions(): ArchFunction[] {
    const sourceFiles = this.project.getSourceFiles()
    const folderMatchers = this._folders.map((g) => picomatch(g))
    const ignoreMatchers = this._ignorePaths.map((g) => picomatch(g))
    const testMatchers = this._ignoreTests ? TEST_PATTERNS.map((g) => picomatch(g)) : []

    const allFunctions: ArchFunction[] = []

    for (const sf of sourceFiles) {
      if (
        !this.passesFileFilters(
          sf.getFilePath(),
          folderMatchers,
          ignoreMatchers,
          testMatchers,
          relativeToRoot(sf, sf.getFilePath(), this.project.tsConfigPath),
        )
      ) {
        continue
      }

      // Detectors scan for a property of the code, not a user-declared subject
      // set, so they always include object-literal functions. `functions()`
      // keeps that opt-in because widening a selector silently changes every
      // existing rule; a detector has no such contract to break, and a
      // duplicated arrow under an object key — a resolver, a route handler, a
      // reducer case — is exactly the copy-paste rot this exists to find.
      for (const fn of collectFunctions(sf, { includeObjectLiteralFunctions: true })) {
        if (this.meetsMinLines(fn)) {
          allFunctions.push(fn)
        }
      }
    }

    return allFunctions
  }

  /** Build fingerprints for all collected functions. */
  private fingerprintAll(functions: ArchFunction[]): FingerprintedFunction[] {
    const result: FingerprintedFunction[] = []
    for (const fn of functions) {
      const body = fn.getBody()
      if (!body) continue
      result.push({ fn, fingerprint: buildFingerprint(body) })
    }
    return result
  }

  /** Compare all pairs of fingerprints, collect those above threshold. */
  private findSimilarPairs(
    items: FingerprintedFunction[],
  ): Array<{ a: ArchFunction; b: ArchFunction; similarity: number }> {
    const pairs: Array<{ a: ArchFunction; b: ArchFunction; similarity: number }> = []

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        if (!a || !b) continue
        // Fast rejection 1: if node counts differ too much, similarity cannot reach threshold
        const maxCount = Math.max(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
        const minCount = Math.min(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
        if (maxCount > 0 && minCount / maxCount < this._minSimilarity) {
          continue
        }
        // Fast rejection 2 (plan 0103): neither body has enough distinct vocabulary
        // for a match to be evidence of anything. `Math.min`, not sum or average —
        // ONE small-vocabulary side is enough to make the pair uninformative
        // regardless of the other side's size.
        const minDistinct = Math.min(
          a.fingerprint.distinctVocabulary,
          b.fingerprint.distinctVocabulary,
        )
        if (minDistinct < this._minDistinctVocabulary) {
          continue
        }
        const similarity = computeSimilarity(a.fingerprint, b.fingerprint)
        if (similarity >= this._minSimilarity) {
          pairs.push({ a: a.fn, b: b.fn, similarity })
        }
      }
    }

    return pairs
  }

  /** Build violations from similar pairs. */
  private buildViolations(
    pairs: Array<{ a: ArchFunction; b: ArchFunction; similarity: number }>,
  ): ArchViolation[] {
    const ruleDescription = this.describe()
    const violations: ArchViolation[] = []

    // Optionally sort pairs by folder for grouped output
    const sortedPairs = this._groupByFolder
      ? [...pairs].sort((x, y) => {
          const folderA = path.dirname(x.a.getSourceFile().getFilePath())
          const folderB = path.dirname(y.a.getSourceFile().getFilePath())
          return folderA.localeCompare(folderB)
        })
      : pairs

    for (const pair of sortedPairs) {
      const nameA = pair.a.getName() ?? '<anonymous>'
      const fileA = pair.a.getSourceFile().getFilePath()
      const lineA = pair.a.getStartLineNumber()

      const nameB = pair.b.getName() ?? '<anonymous>'
      const fileB = pair.b.getSourceFile().getFilePath()
      const lineB = pair.b.getStartLineNumber()

      const pct = Math.round(pair.similarity * 100)

      violations.push({
        rule: ruleDescription,
        element: nameA,
        file: fileA,
        line: lineA,
        message: `${nameA} (${fileA}:${String(lineA)}) is ${String(pct)}% similar to ${nameB} (${fileB}:${String(lineB)})`,
        // Which endpoint is "a" comes from the source-file walk order, which is
        // a property of the filesystem: the same pair reports A→B on one
        // machine and B→A on another, and the reported message alone would
        // give them different identities. Sort the endpoints so the pair reads
        // the same either way. Qualified by path — a bare function name is not
        // unique across files — and without the similarity percentage, which
        // drifts as either body is edited.
        //
        // Limitation: two anonymous functions in one file share an endpoint
        // (`<file>#<anonymous>`) and so share an identity. Nothing stable
        // distinguishes them — a line number would, and that is the coordinate
        // dependence being removed. Measured at 0 collisions over 1006 findings
        // on a real codebase; the collision guard in
        // `tests/integration/baseline-portability.test.ts` is what would catch
        // it becoming common.
        identity: `duplicate-pair::${[`${fileA}#${nameA}`, `${fileB}#${nameB}`].sort().join('::')}`,
        because: this._reason,
      })
    }

    return violations
  }
}
