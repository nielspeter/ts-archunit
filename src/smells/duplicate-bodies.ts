import picomatch from 'picomatch'
import path from 'node:path'
import { SmellBuilder } from './smell-builder.js'
import { collectFunctions } from '../models/arch-function.js'
import { buildFingerprint, computeSimilarity } from './fingerprint.js'
import type { Fingerprint } from './fingerprint.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchProject } from '../core/project.js'
import type { ArchFunction } from '../models/arch-function.js'

/** A function paired with its structural fingerprint. */
interface FingerprintedFunction {
  fn: ArchFunction
  fingerprint: Fingerprint
}

/** Test file patterns for ignoreTests(). */
const TEST_PATTERNS = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']

export class DuplicateBodiesBuilder extends SmellBuilder {
  private _minSimilarity = 0.85

  constructor(project: ArchProject) {
    super(project)
  }

  /** Set the AST similarity threshold. Default: 0.85. */
  withMinSimilarity(threshold: number): this {
    this._minSimilarity = threshold
    return this
  }

  protected detect(): ArchViolation[] {
    const functions = this.collectFilteredFunctions()
    const fingerprinted = this.fingerprintAll(functions)
    const pairs = this.findSimilarPairs(fingerprinted)
    return this.buildViolations(pairs)
  }

  protected describe(): string {
    const scope = this._folders.length > 0 ? this._folders.join(', ') : 'all files'
    return `No duplicate function bodies in ${scope} (similarity >= ${String(this._minSimilarity)})`
  }

  /** Check if a file path passes all glob-based filters. */
  private passesFileFilters(
    filePath: string,
    folderMatchers: picomatch.Matcher[],
    ignoreMatchers: picomatch.Matcher[],
    testMatchers: picomatch.Matcher[],
  ): boolean {
    if (folderMatchers.length > 0 && !folderMatchers.some((m) => m(filePath))) return false
    if (ignoreMatchers.some((m) => m(filePath))) return false
    if (testMatchers.some((m) => m(filePath))) return false
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
  private collectFilteredFunctions(): ArchFunction[] {
    const sourceFiles = this.project.getSourceFiles()
    const folderMatchers = this._folders.map((g) => picomatch(g))
    const ignoreMatchers = this._ignorePaths.map((g) => picomatch(g))
    const testMatchers = this._ignoreTests ? TEST_PATTERNS.map((g) => picomatch(g)) : []

    const allFunctions: ArchFunction[] = []

    for (const sf of sourceFiles) {
      if (!this.passesFileFilters(sf.getFilePath(), folderMatchers, ignoreMatchers, testMatchers)) {
        continue
      }

      for (const fn of collectFunctions(sf)) {
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
        // Fast rejection: if node counts differ too much, similarity cannot reach threshold
        const maxCount = Math.max(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
        const minCount = Math.min(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
        if (maxCount > 0 && minCount / maxCount < this._minSimilarity) {
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
        because: this._reason,
      })
    }

    return violations
  }
}
