/**
 * The one text for "this project loaded nothing", owned in one place.
 *
 * Two surfaces state this fact: `diagnose()` (and through it `doctor`) and
 * `SliceRuleBuilder`'s discovery message, which is what a **failing `check`
 * build** prints. They were written separately and had already diverged at
 * birth — the builder said only "Check that this tsconfig includes your
 * sources", which bug 0031 itself records as not actionable for a config that
 * has no `include` at all, while `diagnose` named the solution-style cause. So
 * the high-stakes surface carried the weaker text.
 *
 * This is the `assertionAdvice` precedent applied to a second state: plan 0070
 * put that one behind a single owner after the two copies were **measured**
 * diverging, and a later review found a third copy re-added with nothing
 * failing. Two texts for one state is a trust problem for an agent diffing
 * them.
 *
 * Reported by review of the bug 0031 fix, which created the second copy while
 * quoting the bug's own instruction not to.
 */
import type { ArchProject } from './project.js'

/**
 * Why nothing can match, and what to do about it.
 *
 * Deliberately **not** ending in a period: both call sites append their own
 * trailing sentence.
 *
 * ## The solution-style clause is conditional, and that is the point
 *
 * An earlier revision **asserted** it — "this one is solution-style, so point
 * the rules at the tsconfig that does" — and review refuted that: the imperative
 * is impossible on several reachable shapes with no such sibling (an `include`
 * that matches nothing yet, a repository with no `.ts` files, `allowJs: false`
 * over a `.js` tree, `"files": []` with no `references` at all). ADR-008
 * rule 2 — a stated fix that is impossible on the path that produced it is
 * worse than none.
 *
 * The obvious repair was to read the tsconfig and state it only when true. That
 * was **written, and then removed by this project's own architecture rules**:
 * it put `JSON.parse` in `src/core/`, which `hygiene/no-json-parse` bans with
 * the reason "ts-archunit analyzes AST, not JSON", and `references` is not in
 * `getCompilerOptions()` so ts-morph cannot supply it (ADR-002 rules out the
 * raw TypeScript API). Exempting the rule to accommodate this file would be
 * the wrong direction — the rule is right.
 *
 * So the clause is phrased as a **condition the reader can evaluate in one
 * glance at their own file**. It is true whether or not their config has that
 * shape, it names the mechanism that produced the commonest real occurrence,
 * and it asserts nothing the tool has not checked.
 */
export function emptyProjectAdvice(project: ArchProject): string {
  return (
    `the project loaded 0 source files (${project.tsConfigPath}), so no glob can match. ` +
    `Check that this tsconfig includes your sources — and if it delegates to project ` +
    `references ("files": [] with "references"), it loads none of them itself, so the rules ` +
    `need the tsconfig that holds your sources rather than this one`
  )
}
