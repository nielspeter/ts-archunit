import { TerminalBuilder } from './terminal-builder.js'
import type { ArchProject } from './project.js'
import type { GlobPosition, GlobSite } from './glob-site.js'
import type { GlobFault } from './glob-diagnosis.js'
import type { OnDisk } from './disk-set.js'
import { diagnoseGlob, FAULT_ADVICE, ON_DISK_ADVICE } from './glob-diagnosis.js'
import { globSitesOf, isDeadSite } from './glob-evaluator.js'
import { pathUniverse } from './path-universe.js'
import { diskSet } from './disk-set.js'
import { isDeadGlobTree } from './glob-evaluator.js'
import type { RuleBuilderLike } from './rule-builder-like.js'
import type { GlobNode } from './glob-site.js'

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
   * reports it VERBATIM as the finding's advice, so the doctor and the runtime
   * warning are the same string by construction (plan 0070) — they were
   * measured diverging, and two texts for one state is a trust problem for an
   * agent diffing them.
   */
  assertionAdvice?: () => string
  /** The project this rule was built against. */
  getProject?: () => ArchProject | undefined
}

/** One thing wrong with one rule, named specifically enough to fix. */
export interface DiagnosticFinding {
  /**
   * `'dead-glob'` — a glob that can never match; `'no-condition'` — a rule
   * that asserts nothing; `'project-unknown'` — a rule whose globs could not
   * be checked because it cannot name the project it was built against.
   */
  readonly kind: 'dead-glob' | 'no-condition' | 'project-unknown'
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
}

/**
 * Report what each rule cannot enforce, without running any of them.
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
    // greens: five of the thirteen builders cannot name their project, so a
    // rule file made entirely of `crossLayer()` or `resolvers()` rules used to
    // report a clean bill of health and exit 0 with every one of its globs
    // unchecked. Say so instead.
    if (!target) {
      if (trees.length > 0) {
        findings.push({
          kind: 'project-unknown',
          rule: name,
          advice:
            'this rule declares globs but cannot say which project it was built against, so they were not checked. A builder constructed directly rather than through its entry point has no project to report',
        })
      }
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
        if (site.position === 'exclusion' || site.position === 'condition') continue
        if (!isDeadSite(site, universe)) continue
        findings.push(describe(site, name, universe, target))
      }
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
  return (described?.id || described?.rule) ?? 'unnamed rule'
}

/** Whether the rule reached a terminal with no condition attached. */
function hasNoCondition(rule: DiagnosableRule): boolean {
  return rule.assertsSomething?.() === false
}
