import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ArchViolation } from '../core/violation.js'
import { discoverIdentityRoot, normalizeIdentityText, toPortablePath } from './identity-root.js'

/**
 * Identity-hash format version.
 *
 * 1 — sha256(rule::element::message) verbatim; absolute paths leak in.
 * 2 — the repository root is replaced with a token first, so identity is
 *     portable across checkouts (bug 0010).
 *
 * A version-1 file cannot be matched against version-2 hashes, so loading one
 * produces a meta-finding telling the reader to regenerate, rather than
 * silently reporting every accepted violation as new.
 */
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
  /** Relative file path (relative to baseline file location) */
  file: string
  /** Line number at time of baseline (informational, not used for matching) */
  line: number
  /** Stable identity hash: sha256(rule + element + message) */
  hash: string
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
 * Options shared by baseline loading and generation.
 */
export interface BaselineOptions {
  /**
   * Repository/workspace root used to make violation identity portable.
   *
   * Defaults to the outermost `.git` (or `package.json`) directory above the
   * baseline file. Pass it explicitly when the baseline lives outside the
   * repository, or when the default would resolve above the checkout — the
   * value must be the same on every machine, so it should be derived from the
   * repository layout and never from `process.cwd()`.
   *
   * The **same** root must be used to generate and to load, or nothing matches.
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
  const hashes = new Set(
    parsed.violations
      .map((entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        'hash' in entry &&
        typeof entry.hash === 'string'
          ? entry.hash
          : undefined,
      )
      .filter((hash: string | undefined): hash is string => hash !== undefined),
  )

  return new Baseline(hashes, root, hashVersion, resolved)
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
    }))

  const baseline: BaselineFile = {
    generatedAt: new Date().toISOString(),
    hashVersion: HASH_VERSION,
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
   * A baseline written in an older hash format matches nothing, which on its
   * own looks like "every accepted violation regressed at once". That is a
   * misleading failure, so it is reported as what it is — see
   * \{@link staleFormatFinding\}.
   */
  filterNew(violations: ArchViolation[]): ArchViolation[] {
    const kept = violations.filter((v) => v.bypassFilters === true || !this.isKnown(v))
    const stale = this.staleFormatFinding()
    return stale === undefined ? kept : [stale, ...kept]
  }

  /**
   * A meta-finding for a baseline whose hashes predate portable identity.
   *
   * Emitted only when the file actually holds entries: an absent or empty
   * baseline has nothing to mismatch, and failing there would break the
   * documented "start with no baseline" path.
   *
   * Carries `bypassFilters` for the reason every meta-finding does — the
   * filters are what it is reporting on, so they must not be able to hide it
   * (ADR-008; plan 0067).
   */
  private staleFormatFinding(): ArchViolation | undefined {
    if (this.hashVersion >= HASH_VERSION || this.knownHashes.size === 0) return undefined
    const where = this.sourcePath ?? 'the baseline file'
    return {
      rule: 'ts-archunit: baseline format',
      element: 'baseline',
      file: '',
      line: 0,
      message:
        `Baseline at ${where} was written in identity format v${String(this.hashVersion)}; ` +
        `this version reads v${String(HASH_VERSION)}. Its ${String(this.knownHashes.size)} entries ` +
        `match nothing, so every accepted violation is being reported as new.`,
      because:
        'v1 identity embedded absolute file paths, so a baseline generated on one machine never matched on another (bug 0010).',
      suggestion: `Regenerate it: \`npx ts-archunit baseline --output ${where}\`. Review the diff — entries that vanish were never matching in CI.`,
      bypassFilters: true,
    }
  }

  /** Number of known violations in the baseline */
  get size(): number {
    return this.knownHashes.size
  }
}
