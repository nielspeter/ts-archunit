import { execSync } from 'node:child_process'
import path from 'node:path'
import type { ArchViolation } from '../core/violation.js'

/**
 * A diff filter that restricts violation reporting to files
 * changed since a base branch.
 *
 * IMPORTANT: Rules evaluate the FULL project (needed for cross-file
 * rules like cycles and layer ordering). Only the REPORTING is filtered
 * to changed files. This ensures correctness — a new file that creates
 * a cycle is detected even though the cycle involves unchanged files.
 */
export class DiffFilter {
  private readonly changedFiles: Set<string>

  constructor(changedFiles: Set<string>) {
    this.changedFiles = changedFiles
  }

  /**
   * Filter violations to only those in changed files.
   */
  filterToChanged(violations: ArchViolation[]): ArchViolation[] {
    return violations.filter((v) => this.changedFiles.has(v.file))
  }

  /** Number of changed files detected */
  get size(): number {
    return this.changedFiles.size
  }
}

/**
 * Create a diff filter from git, comparing HEAD against a base branch.
 *
 * Uses `git diff --name-only <base>...HEAD` to find changed files.
 * Resolves relative paths to absolute paths for matching against
 * violation file paths (which are always absolute).
 *
 * @param baseBranch - The base branch to diff against (default: 'main')
 * @returns A DiffFilter for use with check(\{ diff \})
 *
 * @example
 * // Only report violations in files changed since main
 * classes(p).should().notContain(call('eval')).check(\{ diff: diffAware('main') \})
 */
export function diffAware(baseBranch: string = 'main'): DiffFilter {
  const cwd = process.cwd()

  let output: string
  try {
    output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // Not a git repo, or base branch doesn't exist — return all files as "changed"
    // This means no filtering, which is the safe default
    console.warn(
      `[ts-archunit] Could not run git diff against '${baseBranch}'. All violations will be reported.`,
    )
    return new DiffFilter(new Set())
  }

  if (output === '') {
    // No changes — empty set means nothing is "changed", so all violations are filtered out
    return new DiffFilter(new Set())
  }

  const changedFiles = new Set(
    output.split('\n').map((relativePath) => path.resolve(cwd, relativePath)),
  )

  return new DiffFilter(changedFiles)
}
