import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ArchViolation } from '../core/violation.js'
import {
  discoverIdentityRoot,
  normalizeIdentityText,
  toPortablePath,
} from '../core/identity-root.js'

/**
 * Identity-hash format version.
 *
 * 1 — sha256(rule::element::message) verbatim; absolute paths leak in.
 * 2 — the repository root is replaced with a token first, so identity is
 *     portable across checkouts (bug 0010).
 *
 * Note that v2 is byte-identical to v1 for any violation whose fields contain
 * no path, so most v1 baselines keep matching. The version alone is therefore
 * NOT grounds to fail — see `unmatchedBaselineFinding`, which fires on the
 * measurement instead.
 */
// Stays 2 through 0.23.0, deliberately. Accumulate (bug 0020) lengthens
// `buildRuleDescription()` for a rule derived off a held rule and for a
// pre-`.should()` `satisfy()`, and the description is hashed — so those entries
// stop matching. That is a change in the hash's *input*, not in how it is
// computed: `hashViolation` below never reads this constant.
//
// 0.23.0 drafted a bump to 3 to signal it and two independent reviews measured
// that as a defect. It matches no entry differently, and the only thing it
// changes is which `cause` sentence `unmatchedBaselineFinding` picks — so every
// user holding a pre-0.23.0 baseline that matched nothing for an unrelated
// reason would be told the format was "the likely cause", which cannot be true,
// while the branch naming the cause that usually is (a differently-resolved
// root) became unreachable. Bump this only when `hashViolation` changes.
//
// The unmatched *entry* still cannot be diagnosed — see bug 0027; that is the
// gap the bump was reaching for and did not close.
const HASH_VERSION = 2

/**
 * A single entry in the baseline file.
 *
 * Violations are identified by rule + file + content hash.
 * Line numbers are stored for human readability but NOT used for matching —
 * they drift as code moves. The content hash (of the violation message +
 * element name) provides stable identity.
 */
export interface BaselineEntry {
  /** Rule description (from the fluent chain) */
  rule: string
  /** File path relative to the identity root (see `root` below), forward-slashed */
  file: string
  /** Line number at time of baseline (informational, not used for matching) */
  line: number
  /** Stable identity hash: sha256(rule + element + message) */
  hash: string
  /**
   * Subject hash: sha256(element + message), i.e. identity WITHOUT the rule
   * description. Written since 0.24.0 and optional, so a baseline from an
   * earlier version still loads — it simply cannot be diagnosed when an entry
   * stops matching, which is honest degradation rather than a guessed cause.
   * See \{@link hashSubject\} for what it is for.
   */
  subject?: string
}

/**
 * The baseline file structure.
 */
export interface BaselineFile {
  /** ISO timestamp when the baseline was generated */
  generatedAt: string
  /**
   * Identity-hash format version. Absent means 1 — a baseline written before
   * paths were stripped from identity, whose hashes cannot be matched.
   */
  hashVersion?: number
  /**
   * Where the identity root sits **relative to this file**, e.g. `'../..'`.
   *
   * Recorded rather than re-derived because generation and loading otherwise
   * discover the root independently, and a disagreement between them is
   * silent: every hash differs, the baseline matches nothing, and the format
   * version is identical on both sides so nothing notices. A relative position
   * is a property of the repository layout, so it is the same on every machine
   * — which is exactly what the absolute root is not.
   */
  root?: string
  /** Number of violations recorded */
  count: number
  /** The violations */
  violations: BaselineEntry[]
}

/**
 * Compute a stable hash for a violation.
 *
 * Uses rule + element + message as identity. This survives:
 * - Line number changes (code moved)
 * - Unrelated code changes in the same file
 * - **The checkout's absolute location** — see `root` below
 *
 * Does NOT survive:
 * - Rule description changes (rewording .because())
 * - Element renames (class renamed)
 * - Message text changes (condition wording updated)
 *
 * This is intentional — if the rule or element changes,
 * the violation should be re-evaluated.
 *
 * @param root - Repository/workspace root. Every occurrence of it inside the
 *   rule, element and message is replaced with a stable token before hashing.
 *   Producers interpolate absolute paths into those fields, so without a root
 *   the identity encodes the checkout directory and a baseline written on one
 *   machine matches nothing on another (bug 0010). Omitting it preserves the
 *   pre-0.19 hash and is only correct when no field contains a path.
 */
export function hashViolation(violation: ArchViolation, root?: string): string {
  const scrub = (text: string): string =>
    root === undefined ? text : normalizeIdentityText(text, root)
  // A producer that sets `identity` has declared its own canonical form, which
  // supersedes both element and message — see ArchViolation.identity. Without
  // one, the composed string is byte-identical to the pre-0.19 input, so a
  // violation whose fields never contained a path keeps its old hash.
  const subject = violation.identity ?? `${violation.element}::${violation.message}`
  const content = `${scrub(violation.rule)}::${scrub(subject)}`
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * The violation's **subject**: what was found, independent of which rule found it.
 *
 * `hashViolation` above is `rule::element::message`, so editing a rule's
 * predicates or conditions — or accumulating them, which v0.23.0 made happen for
 * a rule derived off a held rule — changes the identity of violations that did
 * not change at all. Those entries stop matching and their already-accepted
 * violations report as **new**, with nothing saying why (bug 0027).
 *
 * This is the differently-derived value that tells the two cases apart:
 *
 * | baseline entry did not match because… | subject present in the run? |
 * | ------------------------------------- | --------------------------- |
 * | the violation was fixed               | no — stay silent, this is success |
 * | the rule's description changed        | yes — say so, and regenerate |
 *
 * Bug 0027's own suggested signal was "an entry whose `rule` string appears under
 * a different hash", and it cannot work: the rule string is precisely what
 * changed. Measured before this was built.
 */
export function hashSubject(violation: ArchViolation, root?: string): string {
  const scrub = (text: string): string =>
    root === undefined ? text : normalizeIdentityText(text, root)
  const subject = violation.identity ?? `${violation.element}::${violation.message}`
  return createHash('sha256').update(scrub(subject)).digest('hex').slice(0, 16)
}

/** Forward slashes so the recorded root reads the same on Windows and CI. */
function toPosix(value: string): string {
  return value.replaceAll('\\', '/')
}

/**
 * Options shared by baseline loading and generation.
 */
export interface BaselineOptions {
  /**
   * Repository/workspace root used to make violation identity portable.
   *
   * Defaults to the **nearest** enclosing repository or workspace root above
   * the baseline file — `.git`, then a monorepo marker (`pnpm-workspace.yaml`,
   * `nx.json`, …) or a `package.json` declaring `workspaces`, then the nearest
   * `package.json`. Nearest, not outermost: an ancestor that is also a repo (a
   * home directory under dotfiles version control) would otherwise anchor above
   * the checkout and leave machine-specific segments in the "relative" path.
   *
   * You should rarely need this. `generateBaseline` records where the root sat
   * relative to the file, and `withBaseline` reuses that, so the two ends
   * cannot silently disagree. Pass it only to override both — and then the
   * value must be the same on every machine, so derive it from the repository
   * layout, never from `process.cwd()`.
   */
  readonly root?: string
}

/**
 * Load a baseline from a JSON file.
 *
 * @param baselinePath - Path to the baseline JSON file
 * @param options - See \{@link BaselineOptions\}
 * @returns A Baseline object for use with check(\{ baseline \})
 */
export function withBaseline(baselinePath: string, options: BaselineOptions = {}): Baseline {
  const resolved = path.resolve(baselinePath)
  const baselineDir = path.dirname(resolved)
  const root =
    options.root !== undefined ? path.resolve(options.root) : discoverIdentityRoot(baselineDir)

  if (!fs.existsSync(resolved)) {
    // No baseline file = no known violations = all violations are new
    return new Baseline(new Set(), root, HASH_VERSION)
  }

  const raw = fs.readFileSync(resolved, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('violations' in parsed) ||
    !Array.isArray(parsed.violations)
  ) {
    console.warn(`[ts-archunit] Invalid baseline file format at ${resolved} — treating as empty`)
    return new Baseline(new Set(), root, HASH_VERSION)
  }
  const hashVersion =
    'hashVersion' in parsed && typeof parsed.hashVersion === 'number' ? parsed.hashVersion : 1

  // A recorded root wins over re-discovery: it is what the hashes in this file
  // were actually built against. Re-deriving here is what lets a machine
  // without `.git` disagree with the machine that wrote the file, and that
  // disagreement produces no signal at all (bug 0010, review C2). An explicit
  // `options.root` still wins over both — the caller is overriding on purpose.
  const recordedRoot =
    'root' in parsed && typeof parsed.root === 'string'
      ? path.resolve(baselineDir, parsed.root)
      : undefined
  const effectiveRoot = options.root !== undefined ? root : (recordedRoot ?? root)
  const hashes = new Set<string>()
  // subject hash -> the rule description recorded for it. Only what the
  // description-change diagnosis needs, so a large baseline does not carry a
  // second copy of every entry. Entries written before 0.24.0 have no subject
  // and simply do not appear here.
  const subjects = new Map<string, string>()
  // Annotated as `readonly unknown[]`, not iterated directly: `parsed.violations`
  // is `any[]` after the `Array.isArray` check, and ADR-005 bars both `any` and
  // the `as` that would otherwise be needed to re-narrow it. Assigning to this
  // type is allowed and hands each element back as `unknown`.
  const rawEntries: readonly unknown[] = parsed.violations
  for (const entry of rawEntries) {
    if (entry === null || typeof entry !== 'object') continue
    if ('hash' in entry && typeof entry.hash === 'string') hashes.add(entry.hash)
    if (
      'subject' in entry &&
      typeof entry.subject === 'string' &&
      'rule' in entry &&
      typeof entry.rule === 'string'
    ) {
      subjects.set(entry.subject, entry.rule)
    }
  }

  return new Baseline(hashes, effectiveRoot, hashVersion, resolved, subjects)
}

/**
 * Generate a baseline file from a list of violations.
 *
 * Call this to create/update the baseline:
 * ```typescript
 * const violations = collectAllViolations(rules)
 * generateBaseline(violations, 'arch-baseline.json')
 * ```
 */
export function generateBaseline(
  violations: ArchViolation[],
  outputPath: string,
  options: BaselineOptions = {},
): void {
  const resolved = path.resolve(outputPath)
  const baselineDir = path.dirname(resolved)
  const root =
    options.root !== undefined ? path.resolve(options.root) : discoverIdentityRoot(baselineDir)

  // Config-level meta-findings (empty selector/discovery) must never be
  // baselined away — they carry bypassFilters and are re-kept by filterNew
  // regardless, so writing them in only pollutes the file (plan 0067).
  const entries: BaselineEntry[] = violations
    .filter((v) => v.bypassFilters !== true)
    .map((v) => ({
      rule: v.rule,
      // Root-relative, not baseline-relative: the stored path must read the
      // same in every checkout, and `../../` chains encode the baseline file's
      // depth. Forward slashes so a file written on Windows reads on CI.
      file: toPortablePath(v.file, root),
      line: v.line,
      hash: hashViolation(v, root),
      subject: hashSubject(v, root),
    }))

  const baseline: BaselineFile = {
    generatedAt: new Date().toISOString(),
    hashVersion: HASH_VERSION,
    root: toPosix(path.relative(baselineDir, root)) || '.',
    count: entries.length,
    violations: entries,
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, JSON.stringify(baseline, null, 2) + '\n')
}

/**
 * A loaded baseline. Passed to check(\{ baseline \}) to filter known violations.
 */
export class Baseline {
  constructor(
    private readonly knownHashes: Set<string>,
    private readonly root: string,
    private readonly hashVersion: number = HASH_VERSION,
    private readonly sourcePath?: string,
    /**
     * Subject hash -> the rule description recorded against it. Empty for a
     * baseline written before 0.24.0, which disables the description-change
     * diagnosis rather than guessing at it (bug 0027).
     */
    private readonly knownSubjects: ReadonlyMap<string, string> = new Map(),
  ) {}

  /**
   * Check if a violation is known (exists in the baseline).
   * Known violations are filtered out — they don't cause failures.
   */
  isKnown(violation: ArchViolation): boolean {
    return this.knownHashes.has(hashViolation(violation, this.root))
  }

  /**
   * Filter out known violations, returning only new ones.
   *
   * Config-level meta-findings (empty selector/discovery) are never baselined
   * away — a regenerated baseline must not silence them (ADR-008; plan 0067).
   *
   * A baseline that matches **nothing** looks identical to "every accepted
   * violation regressed at once", so that case is reported as what it is —
   * see \{@link unmatchedBaselineFinding\}.
   */
  filterNew(violations: ArchViolation[]): ArchViolation[] {
    const kept: ArchViolation[] = []
    let matched = 0
    let matchable = 0
    for (const violation of violations) {
      if (violation.bypassFilters === true) {
        kept.push(violation)
        continue
      }
      matchable += 1
      if (this.isKnown(violation)) {
        matched += 1
        continue
      }
      kept.push(violation)
    }
    // The specific diagnosis SUPERSEDES the generic one, and not merely for
    // tidiness: it disproves it. `unmatchedBaselineFinding` fires on
    // `matched === 0` and, in the same-version case, tells the reader the likely
    // cause is a differently-resolved repository root. A detected description
    // change means a stored SUBJECT matched — and subjects are scrubbed with the
    // same root as hashes — so the root is demonstrably resolving consistently
    // and the root explanation is false. Reporting both would put two
    // contradictory causes in one run, which is the ADR-008 rule 2 defect the
    // withdrawn HASH_VERSION bump already committed once in this area.
    const descriptionChange = this.descriptionChangeFinding(violations)
    const finding = descriptionChange ?? this.unmatchedBaselineFinding(matched, matchable)
    return finding === undefined ? kept : [finding, ...kept]
  }

  /**
   * A meta-finding for baseline entries that stopped matching because the
   * **rule's description changed**, not because the violation was fixed.
   *
   * The distinction is the whole difficulty (bug 0027). An entry that stops
   * matching is normally success — that is what a ratchet is for — so "some
   * entries did not match" is not evidence of anything, which is why
   * \{@link unmatchedBaselineFinding\} is gated on `matched === 0` and stays
   * silent here. But that leaves the common case unexplained: an accepted
   * violation reported as new, reading like fresh rot in application code.
   *
   * `hashSubject` is the differently-derived value that separates them. A
   * violation in this run whose subject matches a baseline entry, under a
   * different full hash, is the same finding about the same code under a rule
   * whose description moved. A subject present in the baseline and absent from
   * the run was fixed, and says nothing.
   *
   * Silent for a baseline written before 0.24.0: those entries have no subject,
   * so the question cannot be asked and no cause is guessed.
   */
  private descriptionChangeFinding(violations: ArchViolation[]): ArchViolation | undefined {
    if (this.knownSubjects.size === 0) return undefined
    // Rule descriptions the baseline recorded for subjects this run re-reported
    // under a different identity. A Map keyed by the OLD description, so the
    // same edited rule is named once however many violations it has.
    const changed = new Map<string, string>()
    for (const violation of violations) {
      if (violation.bypassFilters === true) continue
      if (this.isKnown(violation)) continue
      const recordedRule = this.knownSubjects.get(hashSubject(violation, this.root))
      if (recordedRule === undefined) continue
      changed.set(recordedRule, violation.rule)
    }
    if (changed.size === 0) return undefined

    const where = this.sourcePath ?? 'the baseline file'
    // Identities, never a total (ADR-008 rule 4): name the rules, both spellings,
    // so the reader can see WHAT changed rather than being told how many did.
    const pairs = [...changed.entries()]
      .map(([was, now]) => `\n  was: ${was}\n  now: ${now}`)
      .join('')
    const plural = changed.size === 1 ? 'rule' : 'rules'
    return {
      rule: 'ts-archunit: baseline',
      element: 'baseline',
      file: '',
      line: 0,
      message:
        `Baseline at ${where} no longer matches ${String(changed.size)} ${plural} whose ` +
        `description changed, so already-accepted violations of ${changed.size === 1 ? 'it' : 'them'} ` +
        `are being reported as new. This is not new rot in your code — the rule was edited, ` +
        `or its conditions accumulated (v0.23.0):${pairs}`,
      because:
        "A violation's identity includes the rule description, so editing a rule re-reports every violation it had already accepted — indistinguishable from a regression unless it is named.",
      suggestion: `Regenerate the baseline: \`npx ts-archunit baseline <your-rule-files> --output ${where}\`. Review the diff: the entries that vanish are the ones listed above, and their replacements should be the same violations under the new description.`,
      bypassFilters: true,
    }
  }

  /**
   * A meta-finding for a baseline that is present, non-empty, and matched
   * **nothing** in a run that produced findings it could have matched.
   *
   * Gated on the measurement, not on the version field. An earlier cut fired
   * whenever `hashVersion` was older, which was wrong for most users: v2
   * hashing is byte-identical to v1 for any violation whose fields contain no
   * path, so the majority of existing baselines still match perfectly. Failing
   * those with "its entries match nothing" was both a false red and a false
   * statement — a derived value reported as a fact with nothing disagreeing
   * with it, which is the ADR-008 rule 5 mistake this bug was about.
   *
   * `matched === 0` is the independently-derived signal, and it covers every
   * cause at once: a v1 file, a root that resolved differently here than where
   * the file was written, or a baseline for a different project entirely.
   *
   * Silent when the run produced nothing to match (`matchable === 0`) — an
   * empty run is not evidence about the baseline. Carries `bypassFilters`
   * because the filters are what it is reporting on (ADR-008; plan 0067).
   */
  private unmatchedBaselineFinding(matched: number, matchable: number): ArchViolation | undefined {
    if (this.knownHashes.size === 0 || matchable === 0 || matched > 0) return undefined
    const where = this.sourcePath ?? 'the baseline file'
    const entries = this.knownHashes.size
    const plural = entries === 1 ? 'entry' : 'entries'
    const cause =
      this.hashVersion < HASH_VERSION
        ? `It was written in identity format v${String(this.hashVersion)} and this version reads v${String(HASH_VERSION)}, which is the likely cause.`
        : this.hashVersion > HASH_VERSION
          ? `It was written in identity format v${String(this.hashVersion)}, which is newer than this version reads (v${String(HASH_VERSION)}) — upgrade ts-archunit rather than regenerating.`
          : 'Same identity format, so the likely cause is that it was generated against a different repository root — see the `root` option on withBaseline()/generateBaseline().'
    return {
      rule: 'ts-archunit: baseline',
      element: 'baseline',
      file: '',
      line: 0,
      message:
        `Baseline at ${where} matched 0 of its ${String(entries)} ${plural} against ` +
        `${String(matchable)} finding(s) in this run, so every one of them is being reported as new. ${cause}`,
      because:
        'A baseline that matches nothing is indistinguishable from a mass regression, and silently reporting the whole set as new hides which of the two happened (bug 0010).',
      suggestion:
        this.hashVersion > HASH_VERSION
          ? 'Upgrade ts-archunit to a version that reads this format.'
          : // `<your-rule-files>` stands in for the caller's own paths on
            // purpose: the command needs rule files unless a config supplies
            // them, and printed without them it fails with "No rule files
            // specified" — a remedy that
            // cannot remediate (ADR-008 rule 2). Measured. The path is left as
            // recorded rather than absolutized, so the line is copyable on a
            // machine other than the one that wrote the baseline.
            `Regenerate it: \`npx ts-archunit baseline <your-rule-files> --output ${where}\` (rule files are implied if a ts-archunit config lists them). Review the diff first — entries that vanish were never matching here.`,
      bypassFilters: true,
    }
  }

  /** Number of known violations in the baseline */
  get size(): number {
    return this.knownHashes.size
  }
}
