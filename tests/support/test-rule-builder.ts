import { Project } from 'ts-morph'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { Condition, ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

// --- Shared test element type (superset of all test files) ---

/**
 * Lightweight element for testing the rule-builder pipeline
 * without needing real ts-morph nodes.
 */
export interface TestElement {
  name: string
  file: string
  line: number
  exported: boolean
}

// --- Concrete test builder ---

/**
 * Minimal concrete RuleBuilder for unit tests.
 *
 * Exposes `withPredicate()` and `withCondition()` so tests can
 * register predicates/conditions directly (the real builders
 * do this through their domain-specific fluent methods).
 */
export class TestRuleBuilder extends RuleBuilder<TestElement> {
  constructor(
    project: ArchProject,
    private elements: TestElement[],
  ) {
    super(project)
  }

  protected getElements(): TestElement[] {
    return this.elements
  }

  /** Register a predicate for testing. */
  withPredicate(predicate: Predicate<TestElement>): this {
    return this.addPredicate(predicate)
  }

  /** Register a condition for testing. */
  withCondition(condition: Condition<TestElement>): this {
    return this.addCondition(condition)
  }
}

// --- Stub project (no real ts-morph project needed) ---

/**
 * An `ArchProject` stub for tests that exercise the builder pipeline without
 * touching the AST — but which **loads files**, and that is load-bearing.
 *
 * It was `{} as ArchProject`. Plan 0099's floor calls `getSourceFiles()` on a
 * path the old code never reached (`deadSelectorFindings()` returns early when
 * `globs()` is empty, which it is for `TestRuleBuilder`), so the stub raised a
 * `TypeError` in five tests rather than failing an assertion.
 *
 * The obvious repair — `getSourceFiles: () => []` — is a TRAP that review
 * measured: an empty list makes `loadedNothing()` true, so `.check() FAILS when
 * no elements match predicates` would start passing on the **empty-project**
 * branch instead of the empty-selection one, and its stated subject ("the
 * condition here is `alwaysFail`, and it never ran") would silently stop being
 * guarded. The files below exist so the project is genuinely loaded and the
 * selection is what is empty.
 */
const stubTsMorph = new Project({ useInMemoryFileSystem: true })
stubTsMorph.createSourceFile('/stub/a.ts', 'export const a = 1\n')
stubTsMorph.createSourceFile('/stub/b.ts', 'export const b = 2\n')

export const stubProject: ArchProject = {
  tsConfigPath: '/stub/tsconfig.json',
  _project: stubTsMorph,
  getSourceFiles: () => stubTsMorph.getSourceFiles(),
}

// --- Predicate helpers ---

/**
 * Predicate that matches elements whose name satisfies the given regex.
 */
export function nameMatches(pattern: RegExp): Predicate<TestElement> {
  return {
    description: `name matches ${String(pattern)}`,
    test: (el) => pattern.test(el.name),
  }
}

// --- Condition helpers ---

/**
 * Condition that always passes (returns no violations).
 */
export function alwaysPass(): Condition<TestElement> {
  return {
    description: 'always passes',
    evaluate: () => [],
  }
}

/**
 * Condition that always produces a violation for every element.
 */
export function alwaysFail(msg = 'violated'): Condition<TestElement> {
  return {
    description: `always fails with "${msg}"`,
    evaluate: (elements: TestElement[], context: ConditionContext): ArchViolation[] =>
      elements.map((el) => ({
        rule: context.rule,
        ruleId: context.ruleId,
        element: el.name,
        file: el.file,
        line: el.line,
        message: `${msg}: ${el.name}`,
        because: context.because,
      })),
  }
}

// --- Element / violation factories ---

/**
 * Create a TestElement with sensible defaults.
 * Override any field by passing a partial.
 */
export function makeElement(overrides: Partial<TestElement> & { name: string }): TestElement {
  return {
    file: `src/${overrides.name}.ts`,
    line: 1,
    exported: true,
    ...overrides,
  }
}

/**
 * Create an ArchViolation with sensible defaults.
 * Override any field by passing a partial.
 */
export function makeViolation(
  overrides: Partial<ArchViolation> & { element: string },
): ArchViolation {
  return {
    rule: 'test rule',
    file: `src/${overrides.element}.ts`,
    line: 1,
    message: `violation: ${overrides.element}`,
    ...overrides,
  }
}
