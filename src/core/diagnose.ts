import { TerminalBuilder } from './terminal-builder.js'
import type { ArchProject } from './project.js'
import type { GlobPosition, GlobSite } from './glob-site.js'
import type { GlobFault } from './glob-diagnosis.js'
import type { OnDisk } from './disk-set.js'
import { diagnoseGlob, syntacticFault, FAULT_ADVICE, ON_DISK_ADVICE } from './glob-diagnosis.js'
import { globSitesOf, isDeadSite } from './glob-evaluator.js'
import { pathUniverse } from './path-universe.js'
import { diskSet } from './disk-set.js'
import { isDeadGlobTree } from './glob-evaluator.js'
import { emptyProjectAdvice, loadedNothing } from './empty-project-advice.js'
import type { RuleBuilderLike } from './rule-builder-like.js'
import type { GlobNode } from './glob-site.js'
import { isFaultPosition } from './glob-site.js'

/**
 * Anything `diagnose()` can inspect: a rule that can describe its globs.
 *
 * Structural rather than `TerminalBuilder`, so a caller can pass the same
 * `RuleBuilderLike[]` array they already hand to `checkAll` without any
 * of it being coupled to a class.
 */
export interface DiagnosableRule extends RuleBuilderLike {
  globs?: () => readonly GlobNode[]
  describeRule?: () => { rule: string; id?: string }
  /**
   * Whether this rule asserts anything about what it selected.
   *
   * A method rather than a look at `_conditions`: that field is protected, and
   * reading it would need a type assertion (ADR-005) to duck-type a private
   * name that no subclass is obliged to keep. Optional, because only the
   * predicate/condition builders can be in the condition-less state at all —
   * the rest take their condition as a constructor argument.
   */
  assertsSomething?: () => boolean
  /**
   * The remedy for this rule's assertion-less state. When present, `diagnose`
   * reports it VERBATIM as the finding's advice, so the doctor and the
   * configuration finding the gate raises at runtime carry the same string by
   * construction (plan 0070) — they were measured diverging, and two texts for
   * one state is a trust problem for an agent diffing them. Absent, the base
   * `TerminalBuilder` text is used, from the one place that owns it.
   */
  assertionAdvice?: () => string
  /** The project this rule was built against. */
  getProject?: () => ArchProject | undefined
  /**
   * How many units this rule's family examined — plan 0096.
   *
   * PUBLIC because `DiagnosableRule` is structural: a protected member cannot
   * satisfy it, which is the recorded reason `assertsSomething()` is public.
   *
   * The unit differs per family and each names its own (ADR-009 part 1), but
   * every family answers it from the SAME method its `collectViolations()` uses
   * — not a parallel derivation. A first attempt at this plan let the two
   * diverge and they disagreed within one commit.
   *
   * Calling it RUNS that materialization. `diagnose()` and `doctor` used to
   * promise they reported "without running any of them"; that sentence changed
   * with this plan, in the docs as well as here.
   */
  examinedUnits?: () => number
  /**
   * Whether this rule's emptiness was DECLARED — plan 0097, read here by 0096.
   *
   * Public for the same structural reason as `assertsSomething()`. Without it
   * the preview reports a finding on a rule the gate will accept, and tells the
   * reader to do the thing they already did.
   */
  declaresEmpty?: () => boolean

  /**
   * How this family spells the declaration. Absent means the generic
   * `.expectEmpty()`, which is a `TypeError` on `correspondence` — see
   * `TerminalBuilder.emptyDeclarationAdvice()`.
   */
  emptyDeclarationAdvice?: () => string
}

/** One thing wrong with one rule, named specifically enough to fix. */
export interface DiagnosticFinding {
  /**
   * `'project-empty'` — the project loaded no files, so nothing can match and
   * the globs are not the fault (bug 0031); `'dead-glob'` — a glob that can
   * never match; `'no-condition'` — a rule
   * that asserts nothing; `'project-unknown'` — a rule whose globs could not
   * be checked because it cannot name the project it was built against.
   */
  readonly kind:
    | 'dead-glob'
    | 'no-condition'
    | 'project-unknown'
    | 'project-empty'
    /**
     * A rule that examined **zero units** while its project loaded files, and
     * for which nothing else explained the emptiness — plan 0096.
     *
     * The preview for plan 0098, which makes the same state FAIL. Distinct from
     * `'project-empty'` (the instrument loaded nothing) and from `'dead-glob'`
     * (a glob the author wrote matches nothing): this is the family's OWN
     * filters removing everything, including defaults the author never wrote.
     *
     * It lands in `diagnose()` rather than in `doctor` so that a rule file
     * importing a test runner — which `doctor` cannot load, ADR-008 rule 1's
     * corollary — still gets a preview: `expect(diagnose(rules)).toEqual([])`
     * runs inside the consumer's own suite.
     */
    | 'zero-subjects'
    /**
     * An inline `// ts-archunit-exclude` comment naming a rule id no rule
     * declares, so it suppresses nothing — [bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md).
     *
     * Produced by `orphanExclusions()`, never by `diagnose()`: it needs every
     * rule at once, and `diagnose()` is called per rule file.
     */
    | 'orphan-exclusion'
  /** The rule's id if it has one, else its assembled description. */
  readonly rule: string
  /** Where the glob was written: `resideInFolder("**\/src/x/**")`. */
  readonly origin?: string
  readonly glob?: string
  readonly position?: GlobPosition
  readonly fault?: GlobFault
  readonly onDisk?: OnDisk
  /** The sanctioned fix, or an honest list of causes where none is verifiable. */
  readonly advice: string
  /**
   * For `'orphan-exclusion'`, the line the comment sits on.
   */
  readonly line?: number
  /**
   * For `'orphan-exclusion'`, the **source** file holding the comment.
   *
   * Distinct from `ruleFile`, which names where a *rule* was written. An earlier
   * revision reused `ruleFile` for this and gave JSON consumers two different
   * things under one name depending on `kind`.
   */
  readonly sourceFile?: string
  /**
   * The rule file this rule was written in, when the caller knows it.
   *
   * `diagnose()` never sets this — it is handed rules, not files, and inventing
   * a path it cannot verify is the thing this library exists to stop. `doctor`
   * sets it, because its loop over rule files is the only place the mapping
   * exists (bug 0026: `docs/cli.md` claimed identities "in which rule" and that
   * was true of a dead glob's position and false of every `no-condition`
   * finding, whose only identity was a prose sentence).
   */
  readonly ruleFile?: string
}

/**
 * Report what each rule cannot enforce, without evaluating their conditions.
 *
 * It DOES materialize each rule's selection, as of plan 0096 — "this rule
 * examined nothing" is a fact about the selection. The docstring said "without
 * running any of them" and that stopped being true; it is the IDE-hover contract
 * for an exported function, so it is corrected here and not only in `docs/`.
 *
 * The in-process half of `doctor`. It exists because rules written inside
 * vitest are a co-equal documented path (`docs/running-in-tests.md`), and a
 * CLI-only diagnostic would leave half the users unable to measure before R3
 * flips anything — which is the one job R2a has.
 *
 * Reports **identities, never totals**: which glob, in which rule, at which
 * position. A count is a snapshot, and under ADR-008 rule 4 a snapshot is the
 * thing that rots. Callers who want a number can take `.length`.
 */
export function diagnose(
  rules: readonly DiagnosableRule[],
  project?: ArchProject,
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = []
  /**
   * Projects already reported empty, by OBJECT not by path.
   *
   * The path is not an identity: `workspace([...])` sets `tsConfigPath` to the
   * alphabetically first of N configs (`project.ts`), so a `workspace()` and a
   * `project()` naming that same config collided — and the loser was dropped
   * silently, contributing no finding at all. A false green inside the fix for
   * a false green. `project()` and `workspace()` are both memoized, so object
   * identity IS project identity, and it is what `pathUniverse` and `diskSet`
   * already key on.
   */
  const emptyProjects = new WeakSet<ArchProject>()

  for (const rule of rules) {
    const name = ruleName(rule)

    // PER RULE, not once for the whole array. Taking the first project any
    // rule could name and diagnosing everything against it is wrong in both
    // directions: a rule file with two `project()` calls gets half its globs
    // checked against the wrong universe — the documented monorepo hazard,
    // committed by the diagnostic itself — and a file whose rules cannot name
    // a project at all got silence.
    // The rule's own project WINS over the parameter. Backwards, the parameter
    // silently re-checks every rule against one universe — which is the
    // documented monorepo hazard the paragraph above complains about, and the
    // `project-unknown` advice used to recommend it. The parameter is a
    // fallback for rules that cannot name a project, which is the only case it
    // was ever needed for.
    const target = rule.getProject?.() ?? project

    // Where this rule's findings begin, so the tail can ask whether anything
    // else already explained an empty examination (plan 0096's precedence
    // ruling). The gate has the same shape at `terminal-builder.ts` — each fault
    // REPLACES what follows — and `diagnose()` must mirror it or the preview
    // disagrees with the thing it previews.
    //
    // ABOVE the `no-condition` push, deliberately. It sat below on the first
    // pass, so the tail could never see a missing assertion and measured
    // ['no-condition','zero-subjects'] on three shapes — while the comment on
    // the tail claimed a missing assertion already named a cause. The code
    // contradicted its own comment.
    const before = findings.length

    // A rule with a selector and no condition asserts nothing about what it
    // selected. Reported here so that R3b's gate can see proposal 019 at all:
    // a doctor that reported only glob faults would pass while 019's blast
    // radius was completely unknown — this plan's own question, asked of its
    // own gate.
    if (hasNoCondition(rule)) {
      findings.push({
        kind: 'no-condition',
        rule: name,
        // The builder's own per-state remedy when it offers one — the same
        // string the runtime prints — falling back to the generic form for a
        // DiagnosableRule that predates the hook. The old fixed text here said
        // "add a .should() clause", which is the wrong remedy for the main
        // shape (the .should() is present; the condition is not).
        // The builder's own per-state remedy. No literal fallback string here:
        // an earlier revision hard-coded the generic text a second time, and a
        // review measured either copy being rewritten with nothing failing —
        // two strings in the mechanism whose stated purpose is one string, one
        // place. A DiagnosableRule that predates the hook gets the base
        // method's text, from the one place that owns it.
        advice: rule.assertionAdvice?.() ?? TerminalBuilder.prototype.assertionAdvice.call(rule),
      })
    }

    const trees = rule.globs?.() ?? []

    // Silence here would be a false green in the tool built to remove false
    // greens: a rule that declares globs and cannot say which project to check
    // them against used to be skipped, so a rule file made entirely of such
    // rules reported a clean bill of health and exited 0 with every one of its
    // globs unchecked. Say so instead.
    //
    // This comment used to name `crossLayer()` and `resolvers()` as the
    // builders that could not name their project — and by the time it was read
    // again, `48e3391` had given both a `getProject()`, so it named as examples
    // the two shapes the fix had repaired. `tests/core/diagnose.test.ts` pins
    // the truth in both directions: one test drives this branch, and a second
    // asserts a `crossLayer` rule does NOT reach it. Hence no roster and no
    // count here — a builder reaches this branch exactly when it implements no
    // `getProject()` and no project was passed in, which is checked on the
    // line below rather than remembered in prose.
    if (!target) {
      if (trees.length > 0) {
        findings.push({
          kind: 'project-unknown',
          rule: name,
          advice:
            'this rule declares globs but cannot say which project it was built against, so they were not checked. A builder constructed directly rather than through its entry point has no project to report',
        })
        // ...but the syntactic faults do not need a project, so they are still
        // reported here rather than held back for a run that may never happen.
        findings.push(...syntacticFindings(name, trees))
      }
      // Evidence is a fact about the FAMILY, not about whether we could name its
      // project — so this branch reports it too. Under the SAME gate as the tail:
      // pushed unconditionally it produced ['project-unknown','dead-glob',
      // 'zero-subjects'], the very shape this plan condemns, on the one path the
      // ruling had not been extended to.
      if (findings.length === before) {
        const noProjectEvidence = zeroSubjectsFinding(rule, name)
        if (noProjectEvidence !== undefined) findings.push(noProjectEvidence)
      }
      continue
    }

    // Bug 0031. When the project loaded nothing, EVERY glob is dead and none
    // of them is the reason. Diagnosing them one by one produced six findings
    // whose advice said "a path segment is misspelled" about correctly spelled
    // globs, measured against a real adopting codebase whose root tsconfig is
    // `"files": []` plus project references.
    //
    // The rule is not new here: `slice-rule-builder.ts` already states it —
    // "blaming the glob would send the caller to the wrong file entirely" —
    // and `check` printed the right cause in the same run this printed the
    // wrong one.
    //
    // Once per PROJECT, not per rule and not per glob: the identity of this
    // fault is the tsconfig, so that is what ADR-008 rule 4 asks be named.
    // Deduped by path rather than by object because the path is what the
    // message prints, and printing one sentence twice is the thing being
    // fixed.
    if (loadedNothing(target)) {
      if (!emptyProjects.has(target)) {
        emptyProjects.add(target)
        findings.push({
          kind: 'project-empty',
          rule: name,
          // One owner, shared with the builder's failing-check message. The
          // clause "Reported once for this project" used to be here and was
          // FALSE on the primary surface: `doctor` calls `diagnose()` once per
          // rule file, so two files against one empty tsconfig printed the
          // sentence claiming it was printed once, twice. Measured by review.
          advice: emptyProjectAdvice(target),
        })
      }
      // The syntactic faults survive an empty project: they are properties of
      // the glob text, not of what loaded, so withholding them buys the reader
      // a second failing round trip.
      findings.push(...syntacticFindings(name, trees))
      // Skip the rest of the glob walk. Not an optimisation — reporting those
      // globs is the bug, because every one would carry a cause that is false.
      continue
    }

    const universe = pathUniverse(target)

    for (const tree of trees) {
      // Only diagnose sites inside a tree that is actually dead. A live tree
      // may still contain a dead site — `or(dead, live)` is a working rule —
      // and reporting the dead one there is the false red the tree exists to
      // prevent.
      if (!isDeadGlobTree(tree, universe)) continue
      for (const site of globSitesOf(tree)) {
        // An exclusion matching zero is remedy-optional (proposal 006) and
        // never a fault, and a positive condition glob is indistinguishable
        // from an armed tripwire that has not fired. Reporting either asserts
        // a remedy for a non-fault — and `position` used to be copied into the
        // finding and never read, so both fired.
        if (!isFaultPosition(site.position)) continue
        if (!isDeadSite(site, universe)) continue
        findings.push(describe(site, name, universe, target))
      }
    }

    // LAST, and only if nothing else spoke for this rule. A dead glob, a missing
    // assertion or an empty project each already names a cause with its own
    // remedy; adding "your narrowing removed everything" beside one of them
    // prints the derived symptom above the root cause, with advice that is false
    // on that path. The first attempt emitted this first and unconditionally,
    // which measured as ['zero-subjects','dead-glob'] for a single typo and
    // broke the invariant bug 0040 is filed for — that `diagnose()` and the gate
    // agree about a dead discovery glob.
    if (findings.length === before) {
      const evidence = zeroSubjectsFinding(rule, name)
      if (evidence !== undefined) findings.push(evidence)
    }
  }
  return findings
}

/**
 * A rule that examined nothing, when nothing else explained why — plan 0096.
 *
 * Returns `undefined` unless the family answers `examinedUnits()` and answered
 * zero. Two callers, on purpose: the project-unknown branch (a family with no
 * project still has evidence — `correspondence` and `schemaFromSDL` have no
 * `ArchProject` at all, and the first attempt gated this on one and gave those
 * two families no preview whatsoever) and the tail of the normal path.
 *
 * NOT called from the project-empty branch. That fault is the instrument, it
 * already has its own finding, and reporting both would print one fault twice
 * — and prefigure 0098's precedence backwards, where an empty project outranks
 * every declaration because a declaration asserts a fact about a loaded corpus.
 */
function zeroSubjectsFinding(rule: DiagnosableRule, name: string): DiagnosticFinding | undefined {
  if (rule.examinedUnits === undefined) return undefined
  if (rule.examinedUnits() !== 0) return undefined
  // The author said empty is the point. Reporting anyway would make the advice
  // below a remedy the reader has already applied — ADR-008 rule 2's loop — and
  // would over-report against 0098's floor, which honours the same mint. That
  // the mint exists at all is why 0097 shipped first; this is its first reader.
  if (rule.declaresEmpty?.() === true) return undefined
  return {
    kind: 'zero-subjects',
    rule: name,
    // ONE cause, because precedence has already removed the others: this fires
    // only when no dead glob, missing assertion or empty project explained the
    // emptiness first. So the remedy can name that cause without the hedging
    // ADR-008 rule 2 forbids — and it must not say "your filters", because the
    // commonest trigger is a default the author never wrote (`minLines` is 5).
    advice:
      'this rule examined 0 subjects, so it can never fail. Its own narrowing removed ' +
      'everything the project loaded — including any default it applies that you did not ' +
      'write. Widen it, or declare the empty state with ' +
      (rule.emptyDeclarationAdvice?.() ?? '.expectEmpty()') +
      ' if that is the point — but the declaration is not itself checked yet, so it ' +
      'silences this without proving anything; widening is the fix, declaring is the ' +
      'exception. A later release makes this state fail at check time; this surface is ' +
      'how you find it first.',
  }
}

/**
 * The faults that need no project at all, reported on the branches that have none.
 *
 * `syntacticFault` takes `(glob, kind, base)` — no universe, no project — and
 * is split out for exactly that reason. `'./src/**'` is dead in every possible
 * project; loading the tsconfig will not fix it. Both early exits below (the
 * project is unknown, the project is empty) used to swallow these, so the
 * reader corrected their config, re-ran, and only then learned the glob was
 * also malformed — a second round trip for a fault already decided.
 *
 * Reported by review. Applies to the pre-existing `project-unknown` branch too,
 * which had the same hole.
 */
function syntacticFindings(rule: string, trees: readonly GlobNode[]): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = []
  for (const tree of trees) {
    for (const site of globSitesOf(tree)) {
      // Same position filter as the main path: an exclusion or condition glob
      // matching nothing is not a fault, and that does not change because the
      // fault is syntactic.
      if (!isFaultPosition(site.position)) continue
      const fault = syntacticFault(site.glob, site.kind, site.base)
      if (fault === undefined) continue
      findings.push({
        kind: 'dead-glob',
        rule,
        origin: site.origin,
        glob: site.glob,
        position: site.position,
        fault,
        advice: FAULT_ADVICE[fault],
      })
    }
  }
  return findings
}

function describe(
  site: GlobSite,
  rule: string,
  universe: ReturnType<typeof pathUniverse>,
  project: ArchProject,
): DiagnosticFinding {
  // The disk set is reached only from here, so a project with no dead globs
  // never walks the filesystem.
  const diagnosis = diagnoseGlob(site, universe, diskSet(project))
  const onDiskAdvice = diagnosis.onDisk ? ON_DISK_ADVICE[diagnosis.onDisk] : ''
  return {
    kind: 'dead-glob',
    rule,
    origin: site.origin,
    glob: site.glob,
    position: site.position,
    fault: diagnosis.fault,
    onDisk: diagnosis.onDisk,
    advice: onDiskAdvice === '' ? FAULT_ADVICE[diagnosis.fault] : onDiskAdvice,
  }
}

function ruleName(rule: DiagnosableRule): string {
  const described = rule.describeRule?.()
  // `||` throughout, never `??`: `describeRule()` returns `rule: ''` for a bare
  // entry point (no predicates, no conditions), and `'' ` is not nullish — so
  // `?? 'unnamed rule'` made the fallback dead code and `doctor` printed an
  // empty rule name for precisely the shape this diagnostic is about. Caught by
  // sabotage, not by reading. The gate derives the same name in
  // `TerminalBuilder.collectWithAssertionGuard`; both must be non-empty, and
  // both are asserted so.
  return described?.id || described?.rule || 'unnamed rule'
}

/** Whether the rule reached a terminal with no condition attached. */
function hasNoCondition(rule: DiagnosableRule): boolean {
  return rule.assertsSomething?.() === false
}
