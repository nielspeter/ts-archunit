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
 * An empty ArchProject stub for tests that only exercise
 * the builder pipeline and never touch the AST.
 */
export const stubProject = {} as ArchProject

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
