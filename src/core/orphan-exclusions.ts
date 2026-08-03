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
import { parseExclusionComments } from './exclusion-comments.js'
import type { ArchProject } from './project.js'
import type { DiagnosableRule } from './diagnose.js'

/**
 * How much of the project the caller actually looked at.
 *
 * `orphanExclusions` compares directives against the ids of the rules it is
 * handed. If that is a **subset** of the project's rules, a directive naming a
 * rule declared elsewhere looks orphaned — so a caller that knows it saw only
 * part of the project says so, and the advice carries the caveat.
 */
export interface OrphanExclusionOptions {
  /** Rule files inspected, when the caller counted them. */
  readonly ruleFilesChecked?: number
  /** Rule files the caller believes exist, when it knows. */
  readonly ruleFilesTotal?: number
}

/** The caveat, or `''` when the caller vouched for full coverage. */
function scopeNote(options?: OrphanExclusionOptions): string {
  const checked = options?.ruleFilesChecked
  if (checked === undefined) return ''
  const total = options?.ruleFilesTotal
  if (total !== undefined && checked >= total) return ''
  const files = checked === 1 ? 'file' : 'files'
  return (
    `Checked against ${String(checked)} rule ${files} only — if this id is declared in a rule ` +
    `file that was not inspected, this report is a false positive and the comment is working. ` +
    `Pass every rule file to be sure. `
  )
}

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
/** The first directive found anywhere, so the aggregate finding has a location. */
function firstDirective(
  projects: readonly ArchProject[],
): { file: string; line: number } | undefined {
  for (const project of projects) {
    for (const sourceFile of project.getSourceFiles()) {
      const text = sourceFile.getFullText()
      if (!text.includes('ts-archunit-exclude')) continue
      const path = sourceFile.getFilePath()
      const [first] = parseExclusionComments(text, path).exclusions
      if (first !== undefined) return { file: path, line: first.line }
    }
  }
  return undefined
}

export function orphanExclusions(
  rules: readonly DiagnosableRule[],
  options?: OrphanExclusionOptions,
): OrphanExclusion[] {
  const declared = new Set<string>()
  const projects: ArchProject[] = []
  for (const rule of rules) {
    const id = rule.describeRule?.().id
    if (id !== undefined && id !== '') declared.add(id)
    const project = rule.getProject?.()
    // By object, not by `tsConfigPath` — that path is not an identity, per
    // `diagnose()`'s own reasoning (bug 0011's class).
    //
    // Note what this does NOT guard against, because the first comment here got
    // it wrong: `workspace([a, b])` builds a **single** ts-morph project and
    // returns one `ArchProject`, so it contributes one entry either way.
    // Measured. The case that needs deduping is two separate `project()` calls
    // whose globs overlap — and that is what `seen` below is for.
    if (project !== undefined && !projects.includes(project)) projects.push(project)
  }

  // Nothing declares an id — so every inline exclusion in this project really IS
  // inert (`isExcludedByComment` returns false without a `ruleId`, and the scan
  // is gated on `ctx.metadata?.id`). Reporting nothing was the first behaviour
  // and it was wrong in the ADR-008 rule 1 direction: those are all real
  // orphans, and the diagnostic was silent about every one of them.
  //
  // Reporting each of them is the other failure — a wall of findings for one
  // authored cause, which is what rule 4 calls a total standing in for an
  // identity. So: **one** aggregate finding naming the cause, which is neither
  // noise nor silence.
  if (declared.size === 0) {
    const anyDirective = firstDirective(projects)
    if (anyDirective === undefined) return []
    return [
      {
        ruleId: '(none declared)',
        file: anyDirective.file,
        line: anyDirective.line,
        advice:
          `No rule declares an id, so **every** inline \`// ts-archunit-exclude\` comment in ` +
          `this project is inert — a comment can only match a rule that carries ` +
          `\`.rule({ id })\`. Add ids to the rules these comments name, or delete the ` +
          `comments. Reported once rather than per comment: one cause, one finding.`,
      },
    ]
  }

  const found: OrphanExclusion[] = []
  const seen = new Set<string>()
  for (const project of projects) {
    for (const sourceFile of project.getSourceFiles()) {
      const path = sourceFile.getFilePath()
      // `getFullText()`, not `fs.readFileSync`. The text is already in memory, so
      // the read was a second I/O that also **silently lost findings**: review
      // measured an in-memory project's stale directive vanishing (ENOENT into
      // the catch) and a `chmod 000` file doing the same with nothing on stderr.
      // A diagnostic whose entire subject is "this silently does nothing" must
      // not silently do nothing. The catch is gone because its cause is gone.
      const text = sourceFile.getFullText()

      // Cheap reject before the expensive parse. `parseExclusionComments` builds
      // a ts-morph source file per call to blank literals (bug 0043), and review
      // measured `doctor` going from 572ms to 2076ms on this repository — 3.6x,
      // on a run reporting zero orphans. Sound because that parse only ever
      // *removes* directives, so a file with no occurrence of the literal text
      // cannot hold one. Measured back to ~700ms with the planted orphan still
      // reported.
      if (!text.includes('ts-archunit-exclude')) continue

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
          // The scope caveat is FIRST, and it is not decoration.
          //
          // Review measured the false positive this module's docstring claims to
          // prevent, reachable through the documented CLI form: `doctor
          // a.rules.ts` on a project whose comment names a rule declared in
          // `b.rules.ts` reported that working comment as an orphan — and then
          // told the reader to **delete it**, which un-waives a real violation.
          // A remedy that is wrong on the path that produced it is worse than
          // none (ADR-008 rule 2), so the caller states its scope and the reader
          // is told what it means.
          advice:
            `${scopeNote(options)}This exclusion names '${comment.ruleId}', which no rule ` +
            `declares — so it suppresses nothing and the rule it was meant to waive is being ` +
            `enforced here. Either correct the id to a rule that exists, or delete the ` +
            `comment. The commonest cause is a rule that was renamed: nothing reports this at ` +
            `check time, because a comment is only read in a file that already produced a ` +
            `finding for that rule.`,
        })
      }
    }
  }
  return found
}
