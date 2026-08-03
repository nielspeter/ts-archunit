/**
 * Exclusion comments that name a rule nobody declares —
 * [bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md).
 *
 * `.excluding()` warns when a pattern matches zero violations. An inline
 * `// ts-archunit-exclude` comment has no equivalent, and **cannot get one on the
 * enforcement path**: comments are parsed only in files that already produced a
 * violation (`execute-rule.ts`'s `result.length > 0` gate), so a directive naming
 * a rule id that no longer exists is never even read. Rename a rule and every
 * comment naming the old id goes inert — silently, permanently.
 *
 * That is the failure v0.37.0's suppression disclosure does **not** cover. That
 * reports what a comment *did* silence; this reports a comment that silences
 * nothing.
 *
 * ## Why a diagnostic and not a finding
 *
 * [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 1's migration
 * corollary: *"a warning is something you hope is read; a command is something
 * someone ran."* This cannot be a check-time finding without parsing every file
 * in scope on every run — the cost the `result.length > 0` gate exists to avoid —
 * so it goes where `doctor` already looks.
 *
 * ## It must see EVERY rule, and that is a real footgun
 *
 * The declared-id set is the union across all rule files. `doctor` diagnoses one
 * file at a time (`cli/commands/doctor.ts`), and a directive naming a rule
 * declared in a *different* file would be reported as an orphan if this were
 * called per file. So it is deliberately **not** part of `diagnose()`: it takes
 * every rule at once, and calling it with a subset produces false orphans.
 *
 * Same shape as `checkAll` versus a per-rule `.check()`, which this project
 * already documents: some facts are only true at the run boundary.
 *
 * ## What it does not catch
 *
 * A directive whose rule id is **correct** but whose placement is wrong — the
 * other half of bug 0044. Catching that needs the enforcement path to know which
 * violations a comment failed to cover, which is option 1 in that bug and costs a
 * parse per file per rule. Stated here rather than left to be discovered.
 */
import fs from 'node:fs'
import { parseExclusionComments } from './exclusion-comments.js'
import type { ArchProject } from './project.js'
import type { DiagnosableRule } from './diagnose.js'

/** One exclusion comment naming a rule id nothing declares. */
export interface OrphanExclusion {
  /** The rule id the comment names. */
  readonly ruleId: string
  /** The source file holding the comment. */
  readonly file: string
  /** The comment's line. */
  readonly line: number
  /** The sanctioned fix. */
  readonly advice: string
}

/**
 * Every exclusion comment in the project naming a rule id no rule declares.
 *
 * @param rules - **All** rules, across every rule file. A subset yields false
 *   orphans; see the module docstring.
 */
export function orphanExclusions(rules: readonly DiagnosableRule[]): OrphanExclusion[] {
  const declared = new Set<string>()
  const projects: ArchProject[] = []
  for (const rule of rules) {
    const id = rule.describeRule?.().id
    if (id !== undefined && id !== '') declared.add(id)
    const project = rule.getProject?.()
    // By object, not by tsConfigPath — `workspace()` makes that path
    // non-unique, and `diagnose()` records the same reasoning for the same
    // reason (bug 0011's class).
    if (project !== undefined && !projects.includes(project)) projects.push(project)
  }

  // Nothing declares an id, so EVERY directive would look orphaned. That is not
  // a diagnosis, it is a misconfiguration of this function — the caller passed
  // rules with no `.rule({ id })` at all, and inline comments require one to
  // work in the first place (`execute-rule.ts`). Report nothing rather than
  // everything: a wall of false orphans is how a diagnostic gets ignored.
  if (declared.size === 0) return []

  const found: OrphanExclusion[] = []
  const seen = new Set<string>()
  for (const project of projects) {
    for (const sourceFile of project.getSourceFiles()) {
      const path = sourceFile.getFilePath()
      let text: string
      try {
        text = fs.readFileSync(path, 'utf-8')
      } catch {
        // An in-memory or virtual file. Nothing to read, nothing to report.
        continue
      }
      for (const comment of parseExclusionComments(text, path).exclusions) {
        if (declared.has(comment.ruleId)) continue
        // One report per (id, file, line): a block directive naming two rules
        // yields two comments, and the same file can be reached through two
        // projects in a workspace.
        const key = `${comment.ruleId} ${path} ${String(comment.line)}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({
          ruleId: comment.ruleId,
          file: path,
          line: comment.line,
          advice:
            `This exclusion names '${comment.ruleId}', which no rule declares — so it ` +
            `suppresses nothing and the rule it was meant to waive is being enforced here. ` +
            `Either correct the id to a rule that exists, or delete the comment. The ` +
            `commonest cause is a rule that was renamed: nothing reports this at check ` +
            `time, because a comment is only read in a file that already produced a ` +
            `finding for that rule.`,
        })
      }
    }
  }
  return found
}
