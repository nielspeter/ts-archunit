import type { ArchProject } from './project.js'
import type { GlobPosition, GlobSite } from './glob-site.js'
import type { GlobFault, OnDisk } from './glob-diagnosis.js'
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
  /** The project this rule was built against. */
  getProject?: () => ArchProject
}

/** One thing wrong with one rule, named specifically enough to fix. */
export interface DiagnosticFinding {
  /** `'dead-glob'` — a glob that can never match — or `'no-condition'`. */
  readonly kind: 'dead-glob' | 'no-condition'
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
  // Default to the project the rules were built against rather than asking the
  // caller to name one. Comparing a rule's globs against a DIFFERENT project
  // than the rule runs on would report faults that do not exist and miss the
  // ones that do — a diagnostic that is wrong in both directions is worse than
  // no diagnostic.
  const target = project ?? rules.find((rule) => rule.getProject)?.getProject?.()
  if (!target) return []
  const universe = pathUniverse(target)
  const findings: DiagnosticFinding[] = []

  for (const rule of rules) {
    const name = ruleName(rule)

    // A rule with a selector and no condition asserts nothing about what it
    // selected. Reported here so that R3b's gate can see proposal 019 at all:
    // a doctor that reported only glob faults would pass while 019's blast
    // radius was completely unknown — this plan's own question, asked of its
    // own gate.
    if (hasNoCondition(rule)) {
      findings.push({
        kind: 'no-condition',
        rule: name,
        advice:
          'this rule selects elements but asserts nothing about them, so it can never fail — add a .should() clause, or delete it',
      })
    }

    for (const tree of rule.globs?.() ?? []) {
      // Only diagnose sites inside a tree that is actually dead. A live tree
      // may still contain a dead site — `or(dead, live)` is a working rule —
      // and reporting the dead one there is the false red the tree exists to
      // prevent.
      if (!isDeadGlobTree(tree, universe)) continue
      for (const site of globSitesOf(tree)) {
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
  return described?.id ?? described?.rule ?? 'unnamed rule'
}

/** Whether the rule reached a terminal with no condition attached. */
function hasNoCondition(rule: DiagnosableRule): boolean {
  return rule.assertsSomething?.() === false
}
