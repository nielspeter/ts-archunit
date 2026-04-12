import picomatch from 'picomatch'
import path from 'node:path'
import type { SourceFile } from 'ts-morph'
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

export class InconsistentSiblingsBuilder extends SmellBuilder {
  private _pattern?: ExpressionMatcher

  constructor(project: ArchProject) {
    super(project)
  }

  /** The pattern that most siblings should follow. */
  forPattern(matcher: ExpressionMatcher): this {
    this._pattern = matcher
    return this
  }

  /** Check if a source file contains any function matching the pattern. */
  private fileMatchesPattern(sf: SourceFile, pattern: ExpressionMatcher): boolean {
    for (const fn of collectFunctions(sf)) {
      const body = fn.getBody()
      if (!body) continue

      const lineCount = body.getText().split('\n').length
      if (lineCount < this._minLines) continue

      if (searchFunctionBody(fn, pattern).found) return true
    }
    return false
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
        because: this._reason,
      })
    }
    return violations
  }

  protected detect(): ArchViolation[] {
    if (!this._pattern) return []

    const filesByFolder = this.groupFilesByFolder()
    const ruleDescription = this.describe()
    const patternDesc = this._pattern.description

    const folderEntries = [...filesByFolder.entries()]
    if (this._groupByFolder) {
      folderEntries.sort((a, b) => a[0].localeCompare(b[0]))
    }

    const violations: ArchViolation[] = []

    for (const [folder, files] of folderEntries) {
      if (files.length < 2) continue

      const { matching, nonMatching } = this.partitionByPattern(files, this._pattern)
      const total = matching.length + nonMatching.length
      if (total === 0) continue
      if (matching.length / total < MAJORITY_THRESHOLD) continue
      if (nonMatching.length === 0) continue

      violations.push(
        ...this.buildFolderViolations(folder, matching, nonMatching, ruleDescription, patternDesc),
      )
    }

    return violations
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
