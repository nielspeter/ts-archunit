import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ArchViolation } from '../core/violation.js'

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
 *
 * Does NOT survive:
 * - Rule description changes (rewording .because())
 * - Element renames (class renamed)
 * - Message text changes (condition wording updated)
 *
 * This is intentional — if the rule or element changes,
 * the violation should be re-evaluated.
 */
export function hashViolation(violation: ArchViolation): string {
  const content = `${violation.rule}::${violation.element}::${violation.message}`
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Convert an absolute file path to a path relative to the baseline file.
 * Baseline files store relative paths so they're portable across machines.
 */
function toRelativePath(absolutePath: string, baselineDir: string): string {
  return path.relative(baselineDir, absolutePath)
}

/**
 * Load a baseline from a JSON file.
 *
 * @param baselinePath - Path to the baseline JSON file
 * @returns A Baseline object for use with check(\{ baseline \})
 */
export function withBaseline(baselinePath: string): Baseline {
  const resolved = path.resolve(baselinePath)
  const baselineDir = path.dirname(resolved)

  if (!fs.existsSync(resolved)) {
    // No baseline file = no known violations = all violations are new
    return new Baseline(new Set(), baselineDir)
  }

  const raw = fs.readFileSync(resolved, 'utf-8')
  const data = JSON.parse(raw) as BaselineFile
  const hashes = new Set(data.violations.map((v) => v.hash))

  return new Baseline(hashes, baselineDir)
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
export function generateBaseline(violations: ArchViolation[], outputPath: string): void {
  const resolved = path.resolve(outputPath)
  const baselineDir = path.dirname(resolved)

  const entries: BaselineEntry[] = violations.map((v) => ({
    rule: v.rule,
    file: toRelativePath(v.file, baselineDir),
    line: v.line,
    hash: hashViolation(v),
  }))

  const baseline: BaselineFile = {
    generatedAt: new Date().toISOString(),
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
    private readonly baselineDir: string,
  ) {}

  /**
   * Check if a violation is known (exists in the baseline).
   * Known violations are filtered out — they don't cause failures.
   */
  isKnown(violation: ArchViolation): boolean {
    return this.knownHashes.has(hashViolation(violation))
  }

  /**
   * Filter out known violations, returning only new ones.
   */
  filterNew(violations: ArchViolation[]): ArchViolation[] {
    return violations.filter((v) => !this.isKnown(v))
  }

  /** Number of known violations in the baseline */
  get size(): number {
    return this.knownHashes.size
  }
}
