# Metrics

Built-in metric rules for complexity, size, and method count thresholds. These rules catch the slow creep of large classes, long functions, and tangled control flow before they become entrenched. Use them as guardrails in CI -- they are cheaper than code review for objective limits.

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethods,
} from '@nielspeter/ts-archunit/rules/metrics'

classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
classes(p).should().satisfy(maxClassLines(300)).warn()
classes(p).should().satisfy(maxMethods(15)).warn()
```

## Class-Level Rules

Class-level metric rules enforce upper bounds on complexity, size, and member counts for class declarations. They prevent individual classes from growing into "god objects" that are hard to test and reason about.

| Rule                         | What it checks                                           |
| ---------------------------- | -------------------------------------------------------- |
| `maxCyclomaticComplexity(n)` | No method/constructor/getter/setter exceeds complexity N |
| `maxClassLines(n)`           | Class spans no more than N lines                         |
| `maxMethodLines(n)`          | No method/constructor/getter/setter exceeds N lines      |
| `maxMethods(n)`              | Class has no more than N methods                         |
| `maxParameters(n)`           | No method/constructor has more than N parameters         |

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
} from '@nielspeter/ts-archunit/rules/metrics'

// Hard rule: no method may exceed complexity 15
classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()

// Advisory: flag large classes
classes(p).should().satisfy(maxClassLines(300)).warn()

// Scoped: only services must have short methods
classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .satisfy(maxMethodLines(50))
  .because('service methods should be focused')
  .warn()

// Enforce small parameter lists
classes(p)
  .should()
  .satisfy(maxParameters(4))
  .because('use an options object for >4 parameters')
  .check()
```

## Function-Level Rules

Function-level rules apply the same kind of guardrails to standalone functions and arrow functions. Use these in codebases that are primarily functional or when you want to enforce limits on functions outside of classes.

| Rule                       | What it checks                         |
| -------------------------- | -------------------------------------- |
| `maxFunctionComplexity(n)` | Function complexity does not exceed N  |
| `maxFunctionLines(n)`      | Function spans no more than N lines    |
| `maxFunctionParameters(n)` | Function has no more than N parameters |

```typescript
import {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '@nielspeter/ts-archunit/rules/metrics'

functions(p).that().resideInFolder('src/**').should().satisfy(maxFunctionComplexity(15)).check()

functions(p).should().satisfy(maxFunctionLines(40)).warn()

functions(p).that().areExported().should().satisfy(maxFunctionParameters(4)).check()
```

## Metric Predicates

Metric predicates let you use thresholds as filters in the `.that()` phase rather than as conditions. This is useful when you want to combine a metric filter with a structural assertion -- for example, "complex classes must be exported" or "classes with many methods should not exist."

For composition with other rules, metric predicates filter elements by threshold in `.that().satisfy()`:

```typescript
import { haveCyclomaticComplexity, haveMoreMethodsThan } from '@nielspeter/ts-archunit'

// "Complex service classes must be exported"
classes(p)
  .that()
  .satisfy(haveCyclomaticComplexity({ greaterThan: 10 }))
  .should()
  .beExported()
  .check()

// "Classes with >10 methods must not exist"
classes(p)
  .that()
  .satisfy(haveMoreMethodsThan(10))
  .should()
  .notExist()
  .because('split large classes into focused services')
  .check()
```

Available predicates:

| Predicate                                      | Entry Point    | Description                            |
| ---------------------------------------------- | -------------- | -------------------------------------- |
| `haveCyclomaticComplexity({ greaterThan: n })` | `classes(p)`   | Class has a method with complexity > n |
| `haveMoreLinesThan(n)`                         | `classes(p)`   | Class spans more than n lines          |
| `haveMoreMethodsThan(n)`                       | `classes(p)`   | Class has more than n methods          |
| `haveComplexity({ greaterThan: n })`           | `functions(p)` | Function has complexity > n            |
| `haveMoreFunctionLinesThan(n)`                 | `functions(p)` | Function spans more than n lines       |

## How Lines Are Counted

ts-archunit counts **span lines** — from the element's first line to its last line, inclusive. This includes blank lines and comments within the element's range. This is consistent with how editors report function/class length.

If you need SonarQube-style NCLOC (non-comment lines of code), write a custom condition using ts-morph's `getLeadingCommentRanges()` API.

## Custom Metric Rules

The raw `cyclomaticComplexity()` calculator is exported for use in custom rules:

```typescript
import { cyclomaticComplexity, defineCondition, createViolation } from '@nielspeter/ts-archunit'

const maxComplexityWithContext = defineCondition('have reasonable complexity', (elements, ctx) => {
  // Custom logic using cyclomaticComplexity()
})
```

## Common Thresholds

| Metric                | Typical threshold | SonarQube default | Notes                                                        |
| --------------------- | ----------------- | ----------------- | ------------------------------------------------------------ |
| Cyclomatic complexity | 10-20             | 15 (cognitive\*)  | \*SonarQube defaults to cognitive complexity, not cyclomatic |
| Class lines           | 300-500           | 500               |                                                              |
| Method/function lines | 30-60             | 60                |                                                              |
| Method count          | 10-20             | 20                |                                                              |
| Parameters            | 3-5               | 7                 |                                                              |
