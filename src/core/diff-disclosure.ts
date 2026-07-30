/**
 * What diff-aware mode suppressed, said out loud.
 *
 * Plan 0071's first instrument. `--changed` (and `check({ diff })`) filter
 * **reporting**, not evaluation — so a run with every finding suppressed is
 * indistinguishable from a clean run: exit 0, no output, `total: 0`. That is
 * the false green ADR-008 exists to prevent, and it is worse here than
 * elsewhere because the reader chose the flag and then forgot it: CI configures
 * `--changed` once and every subsequent run reads as clean.
 *
 * **The count is derived by the caller, never self-reported.** Each call site
 * computes `before.length - after.length` around its own `filterToChanged`
 * call. `DiffFilter` could keep that tally itself, and it deliberately does
 * not: `CheckOptions.diff` is a structural interface (`DiffFilterLike`), so a
 * consumer can pass any object with a `filterToChanged` method, and a filter
 * that under-reports its own suppression would produce exactly the silence
 * this module exists to break. Caller-side subtraction is a differently-derived
 * value (ADR-008 rule 5) and it works for filters we did not write.
 *
 * **Two surfaces, because only one of them can count.**
 *
 * | surface                                  | disclosure           |
 * | ---------------------------------------- | -------------------- |
 * | CLI `check --changed`                    | `suppressionNotice`  |
 * | `checkAll([...])`                        | `suppressionNotice`  |
 * | `.check({ diff })` / `.warn({ diff })`   | `activeNotice`, once |
 *
 * The first two filter once over every collected violation, so they know the
 * whole number. The per-rule terminals do not: `filterToChanged` is called
 * once per rule (`execute-rule.ts`), and a diff-aware suite with 79 rules
 * would print 79 lines — on the channel v0.26.0 made unconditionally visible.
 * There is no per-run aggregation point on that path, so those terminals state
 * the **configuration** instead, once per process. A configuration statement
 * cannot be wrong; a per-rule count presented as a run total would be.
 *
 * A `process.on('exit')` flush was considered and rejected: it would let the
 * per-rule path print one complete total, but a library that installs an exit
 * hook to deliver a correctness-relevant message has made that message
 * dependent on stderr surviving process teardown — untestable in the shape the
 * rest of this project asserts (a real child `vitest run`, bug 0024) without
 * asserting a race. Stating the configuration is weaker and honest.
 */

/** Prefix shared with the rest of the library's stderr output. */
const TAG = '[ts-archunit]'

/**
 * One line naming what was suppressed, or `undefined` when nothing was.
 *
 * `undefined` rather than an empty string so a call site cannot print a blank
 * line by forgetting to check — the two callers both feed this straight into
 * `writeStderr`.
 *
 * @param suppressed - `before.length - after.length`, computed by the caller.
 * @param changedFiles - How many files the filter considered changed, when the
 *   filter exposes it. A user-supplied `DiffFilterLike` need not, in which case
 *   the sentence drops that clause rather than guessing.
 * @param baseBranch - The branch diffed against, when known.
 */
export function suppressionNotice(
  suppressed: number,
  changedFiles?: number,
  baseBranch?: string,
): string | undefined {
  if (suppressed <= 0) return undefined

  const findings = suppressed === 1 ? 'finding' : 'findings'
  // A negative size is `DiffFilter`'s "git was unavailable" sentinel. That path
  // filters nothing, so `suppressed` is 0 and we never reach here — but the
  // guard is cheap and keeps the sentinel from ever reaching a user's screen.
  const scope =
    changedFiles !== undefined && changedFiles >= 0
      ? ` outside the ${String(changedFiles)} changed ${changedFiles === 1 ? 'file' : 'files'}`
      : ' outside the changed files'
  const since = baseBranch === undefined ? '' : ` (diffed against '${baseBranch}')`

  return (
    `${TAG} Diff-aware mode suppressed ${String(suppressed)} ${findings}${scope}${since}. ` +
    `Those findings are real and still present — this run did not check them. ` +
    `Re-run without diff-aware mode to see every finding.`
  )
}

/**
 * Whether {@link activeNotice} has already spoken in this process.
 *
 * Module-scoped rather than per-`DiffFilter`, because the documented pattern
 * constructs a filter **inline per rule** — `.check({ diff: diffAware('main') })`
 * in `docs/core-concepts.md:333` and `docs/what-to-check.md:515` — so
 * per-instance state would still produce one line per rule.
 */
let noticed = false

/**
 * State that diff-aware filtering is on, once per process. Returns `undefined`
 * on every call after the first, and whenever nothing was suppressed.
 *
 * Keyed on a call that actually suppressed something: a diff-aware run whose
 * findings all happen to be in changed files has hidden nothing, and a notice
 * there would train the reader to skip the line that matters.
 */
export function activeNotice(
  suppressed: number,
  changedFiles?: number,
  baseBranch?: string,
): string | undefined {
  if (suppressed <= 0 || noticed) return undefined
  noticed = true

  const scope =
    changedFiles !== undefined && changedFiles >= 0
      ? `the ${String(changedFiles)} ${changedFiles === 1 ? 'file' : 'files'} changed`
      : 'the files changed'
  const since = baseBranch === undefined ? '' : ` since '${baseBranch}'`

  return (
    `${TAG} Diff-aware mode is active: this run reports only findings in ${scope}${since}. ` +
    `Findings in unchanged files are suppressed and will not appear, however many there are. ` +
    `Remove \`diff\` from the check options to see every finding.`
  )
}

/**
 * Forget that {@link activeNotice} has spoken. **Tests only** — a suite
 * asserting the once-per-process contract has to observe the first call, and
 * whichever earlier test filtered first would otherwise have consumed it.
 */
export function resetDiffDisclosureForTests(): void {
  noticed = false
}
