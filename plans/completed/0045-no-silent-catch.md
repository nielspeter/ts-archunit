# Plan 0045: noSilentCatch — Detect Catch Blocks That Swallow Errors

## Status

- **State:** COMPLETED 2026-04-02
- **Priority:** P2 — Common production bug pattern, unique to ts-archunit (no other tool catches this)
- **Effort:** 1.5 days
- **Created:** 2026-04-02
- **Updated:** 2026-04-02 (post-review: fixed destructured binding handling, detection algorithm, pseudocode consistency, expanded tests to ~21)
- **Proposal:** `proposals/no-silent-catch.md` (deleted — superseded by this plan)

## Context

Catch blocks that discard the error without logging or rethrowing are a common source of hidden production bugs. The error disappears silently — no log entry, no stack trace, no alert. Found in real production code: cmless `SocialService.fetchUserProfile` — Google OAuth login failed silently for weeks because the catch block threw a generic `UnauthorizedError` without logging the original error.

This is not project-specific — every codebase has this problem. No linter catches it because it requires inspecting the _structure_ of catch blocks, not just their presence. It belongs alongside `noGenericErrors` in `rules/errors.ts`.

### Design decisions

**Start with the strict "must reference error variable" variant.** The proposal had three variants. The strictest — "catch blocks must reference the caught error variable" — is the most useful and least ambiguous:

- No heuristic pattern matching needed (no hardcoded `logger.*` / `console.*` patterns)
- Zero false positives: a catch block that doesn't reference the error variable AT ALL is objectively wrong
- Catches both "error completely discarded" AND "error replaced without logging"
- Follows the lego bricks principle: generic primitive, not opinionated policy

The "logging detection" variant (configurable logger patterns) can be a follow-up. Starting strict avoids the `noDbCalls` trap of hardcoding framework-specific patterns.

### Post-review changes

Reviewed by architect, backend, and testing. Key changes:

- **Critical: destructured catch bindings.** `findReferencesAsNodes()` on a `VariableDeclaration` with `ObjectBindingPattern` returns zero refs even when destructured properties are used. Fixed: detect binding patterns and check each binding element individually.
- **Critical: class variant pseudocode.** Only scanned `getMethods()`, contradicting the stated design. Fixed: scans methods, constructors, getters, and setters (following `searchClassBody` pattern).
- **Important: use simple Identifier walk, not `findReferencesAsNodes()`.** The Language Service is a whole-program operation — overkill for a block-scoped variable. Simple descendant walk checking `Identifier` nodes matching the variable name is faster, correct (catch variables can't be referenced outside their block), and avoids the `findReferencesAsNodes()` failure edge cases.
- **Important: pseudocode consistency.** Single core function `findSilentCatches(body)` returns `{ node, message }[]`. Each variant wraps results into `ArchViolation[]`.
- **Tests expanded from ~14 to ~21.** Added: destructured binding (pass + fail), empty catch body, catch in arrow within method, `console.log('string')` without error ref, multiple catches in one method, try/catch/finally, expression-bodied arrow negative case.

## What the rule detects

A catch block is a violation if it does NOT reference the catch clause's variable binding anywhere in the block body.

```typescript
// VIOLATION — error is completely discarded
try {
  riskyOp()
} catch {
  return fallbackValue
}

// VIOLATION — error is replaced without reference
try {
  riskyOp()
} catch {
  throw new AppError('something failed')
}

// VIOLATION — catch binding exists but is never used
try {
  riskyOp()
} catch (err) {
  throw new AppError('failed')
}

// VIOLATION — console.log with hardcoded string, error not referenced
try {
  riskyOp()
} catch (err) {
  console.log('something went wrong')
}

// PASS — error is logged
try {
  riskyOp()
} catch (err) {
  logger.error('failed', { err })
  throw new AppError('failed')
}

// PASS — error is rethrown
try {
  riskyOp()
} catch (err) {
  throw err
}

// PASS — error is passed to another function
try {
  riskyOp()
} catch (err) {
  reportError(err)
}

// PASS — error properties accessed
try {
  riskyOp()
} catch (err) {
  if (err instanceof NetworkError) retry()
}

// PASS — destructured binding, property is used
try {
  riskyOp()
} catch ({ message }) {
  logger.error(message)
}
```

## AST approach

This is a **new traversal pattern** for ts-archunit. Existing body analysis searches for _presence_ of expressions. This rule searches for _absence_ of a reference within a scoped block (catch clause).

### Detection algorithm

For each `CatchClause` descendant in the body:

1. **No binding at all:** `catch { ... }` (no variable) — always a violation. There's no error to reference.
2. **Simple binding:** `catch (err) { ... }` — walk the block's descendant `Identifier` nodes. If none match the binding name → violation.
3. **Destructured binding:** `catch ({ message, code }) { ... }` — the name node is an `ObjectBindingPattern` or `ArrayBindingPattern`. Extract each binding element's name, walk the block for matching `Identifier` nodes. If NONE of the destructured names are referenced → violation. (If at least one is referenced, the error is being used.)

**Why simple Identifier walk instead of `findReferencesAsNodes()`:**

The Language Service's `findReferencesAsNodes()` is a whole-program operation — overkill for a variable that is by definition scoped to a single catch block. A simple descendant walk is:

- **Faster:** no Language Service invocation, just AST traversal within a single block
- **Correct:** catch variables cannot be referenced outside their block, so there are no false positives from same-named variables elsewhere
- **Robust:** `findReferencesAsNodes()` can throw on certain node types (see `reverse-dependency.ts` line 218) and returns zero refs for destructured bindings — the simple walk avoids both issues
- **Sufficient:** shadowing within a catch block (`catch (err) { const err = ... }`) is itself a code smell that the rule can legitimately flag

### Core detection function

```typescript
// src/conditions/catch-analysis.ts — new file

import { Node, SyntaxKind } from 'ts-morph'

interface SilentCatchResult {
  node: Node
  message: string
}

/**
 * Find catch clauses in the body that don't reference the caught error.
 * Returns one result per silent catch clause.
 */
export function findSilentCatches(body: Node): SilentCatchResult[] {
  const results: SilentCatchResult[] = []

  for (const catchClause of body.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const varDecl = catchClause.getVariableDeclaration()

    if (!varDecl) {
      // catch { ... } — no binding at all, always a violation
      results.push({
        node: catchClause,
        message: 'catch block has no error binding — error is silently discarded',
      })
      continue
    }

    // Collect the binding names to search for
    const bindingNames = getBindingNames(varDecl)

    // Walk the catch block for Identifier nodes matching any binding name
    const block = catchClause.getBlock()
    const hasReference = block.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
      // Skip the binding declaration itself
      if (id === varDecl.getNameNode()) return false
      return bindingNames.has(id.getText())
    })

    if (!hasReference) {
      const varName = varDecl.getName()
      results.push({
        node: catchClause,
        message: `catch block binds '${varName}' but never references it — error is silently discarded`,
      })
    }
  }

  return results
}

/**
 * Extract all binding names from a catch variable declaration.
 * Handles simple bindings (catch (err)), object destructuring (catch ({ message })),
 * and array destructuring (catch ([code, msg])).
 */
function getBindingNames(varDecl: VariableDeclaration): Set<string> {
  const nameNode = varDecl.getNameNode()

  if (Node.isIdentifier(nameNode)) {
    return new Set([nameNode.getText()])
  }

  if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
    const names = new Set<string>()
    for (const element of nameNode.getElements()) {
      if (Node.isBindingElement(element)) {
        const elementName = element.getNameNode()
        if (Node.isIdentifier(elementName)) {
          names.add(elementName.getText())
        }
      }
    }
    return names
  }

  // Fallback — unknown binding pattern, treat as referenced to avoid false positives
  return new Set(['__unknown__'])
}
```

### Rule factories

All three variants use the same `findSilentCatches(body)` core function. Each variant is responsible for extracting bodies and converting results to `ArchViolation[]`.

```typescript
// src/rules/errors.ts — new exports

export function noSilentCatch(): Condition<ClassDeclaration> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        // Scan ALL class members with bodies: methods, constructors, getters, setters
        const members = [
          ...cls.getMethods(),
          ...cls.getConstructors(),
          ...cls.getGetAccessors(),
          ...cls.getSetAccessors(),
        ]
        for (const member of members) {
          const body = member.getBody()
          if (!body) continue
          for (const result of findSilentCatches(body)) {
            violations.push(createViolation(result.node, result.message, context))
          }
        }
      }
      return violations
    },
  }
}

export function functionNoSilentCatch(): Condition<ArchFunction> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const body = fn.getBody()
        if (!body || !Node.isBlock(body)) continue
        for (const result of findSilentCatches(body)) {
          violations.push({
            rule: context.rule,
            element: fn.getName() ?? '<anonymous>',
            file: fn.getSourceFile().getFilePath(),
            line: result.node.getStartLineNumber(),
            message: result.message,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

export function moduleNoSilentCatch(): Condition<SourceFile> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        for (const result of findSilentCatches(sf)) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: result.node.getStartLineNumber(),
            message: result.message,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}
```

## Variants

| Rule                      | Target    | Description                                                  |
| ------------------------- | --------- | ------------------------------------------------------------ |
| `noSilentCatch()`         | classes   | Catch blocks in class members must reference the error       |
| `functionNoSilentCatch()` | functions | Catch blocks in functions must reference the error           |
| `moduleNoSilentCatch()`   | modules   | Catch blocks anywhere in the module must reference the error |

All three variants use the same `findSilentCatches()` core function. The class variant scans methods, constructors, getters, AND setters — following the `searchClassBody` pattern, not the `noTypeAssertions()` pattern (which incorrectly scans only methods).

## Files

| File                                       | Type                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/conditions/catch-analysis.ts`         | New — `findSilentCatches()`, `getBindingNames()`                               |
| `src/rules/errors.ts`                      | Modified — add `noSilentCatch`, `functionNoSilentCatch`, `moduleNoSilentCatch` |
| `src/index.ts`                             | Modified — re-export new rules                                                 |
| `tests/rules/errors-silent-catch.test.ts`  | New                                                                            |
| `tests/fixtures/rules/src/silent-catch.ts` | New — fixture classes/functions for each test case                             |

No changes to `package.json` — rules go in the existing `./rules/errors` sub-path export.

## Test strategy (~21 tests)

### Violations detected (7 tests)

- `catch { return fallback }` — no binding at all
- `catch (err) { throw new AppError('failed') }` — binding exists but never referenced
- `catch (err) { return null }` — binding exists but never referenced
- `catch (_err) { /* empty */ }` — underscore-prefixed but still unreferenced
- `catch (err) { }` — truly empty catch body (zero statements)
- `catch (err) { console.log('something went wrong') }` — logs hardcoded string, error not referenced
- `catch ({ message }) { return null }` — destructured binding, no property referenced

### Passes — no violation (7 tests)

- `catch (err) { throw err }` — error rethrown
- `catch (err) { logger.error('failed', { err }) }` — error logged
- `catch (err) { reportError(err) }` — error passed to function
- `catch (err) { if (err instanceof NetworkError) retry() }` — error inspected
- `catch (err) { const msg = err.message; throw new AppError(msg) }` — error property accessed
- `catch ({ message }) { logger.error(message) }` — destructured, property referenced
- No try/catch at all — no violation

### Structural edge cases (4 tests)

- Multiple catch clauses in one method — one silent, one not → exactly one violation
- Catch inside arrow function within a class method → found by `getDescendantsOfKind`
- `try/catch/finally` with silent catch → still flagged
- Expression-bodied arrow function → no violation (no block body, no try/catch possible)

### Variant coverage (3 tests)

- `functionNoSilentCatch()` catches silent catch in standalone function
- `moduleNoSilentCatch()` catches silent catch at module level
- Class variant scans constructors and getters (not just methods)

### Fixture structure

Separate fixture classes/functions for each test case, following the pattern in `tests/fixtures/rules/src/error-class.ts`:

```
tests/fixtures/rules/src/silent-catch.ts
  SilentCatchViolation      — methods with various violation patterns
  SilentCatchClean          — methods with proper error handling
  SilentCatchConstructor    — constructor with silent catch
  SilentCatchGetter         — getter with silent catch
  SilentCatchDestructured   — destructured binding cases
  silentCatchFunction()     — standalone function with silent catch
  cleanFunction()           — standalone function with proper error handling
```

## What was built

- `findSilentCatches(body)` core detection in `src/conditions/catch-analysis.ts` — simple Identifier walk (not Language Service)
- `getBindingNames()` handling simple, object-destructured, and array-destructured catch bindings
- Three rule variants: `noSilentCatch()` (class), `functionNoSilentCatch()`, `moduleNoSilentCatch()`
- Class variant scans methods + constructors + getters + setters (not just methods)
- All variants use `createViolation()` consistently for code frames and metadata
- 30 tests covering violations, passes, edge cases, destructured bindings, message assertions
- Known limitations documented in JSDoc

## What was done differently from the plan

- **Detection uses simple Identifier walk, not `findReferencesAsNodes()`** — review found that the Language Service approach is overkill for block-scoped variables, produces false positives on destructured bindings, and can throw on edge cases. The simple walk is faster, more robust, and sufficient.
- **Test count grew from ~21 to 30** — reviews identified missing setter test, array destructuring test, shallow assertion tests, and message content assertions. All added.
- **Destructured binding tests use in-memory projects** — strict TypeScript disallows `catch ({ message })`, so these cases are tested via `new Project({ strict: false })` rather than fixture files.
- **`createViolation()` used for all variants** — the plan's pseudocode had function/module variants constructing inline violation objects. Review recommended using `createViolation()` consistently (the `result.node` is always a `CatchClause`, a real ts-morph Node). Applied.

## Out of scope

### Configurable logger patterns

Deferred. The shipped rule checks "must reference error variable" — universal, pattern-free, zero false positives. A stricter follow-up could enforce that the reference actually goes to a _logging_ call:

```typescript
noSilentCatch({ logPatterns: [/logger\./, /Sentry\.capture/, /console\.(error|warn)/] })
```

This would catch `catch (err) { someMap.set('last', err) }` — the error is referenced but not logged. However, this reintroduces the framework-specific pattern matching problem (what counts as "logging"? winston? pino? custom wrappers?). The baseline rule is the right foundation. Teams that need logging enforcement can compose: `noSilentCatch()` (error must be referenced) + a custom condition asserting the reference is inside a logging call.

### Auto-fix

Cannot be automated. The correct fix depends on context: should the error be logged? rethrown? wrapped? passed to Sentry? The `.suggestion` metadata field provides guidance ("Log the original error before wrapping"), but the actual code change requires human or agent judgment. This is by design — architecture rules flag problems, they don't make design decisions.

### Promise `.catch()` callbacks

This rule covers `try/catch` syntax only. The equivalent pattern in Promise chains — `.catch((err) => { /* silent */ })` — is a separate concern because:

1. It's a `CallExpression` with a callback, not a `CatchClause`. The AST structure is completely different.
2. It's naturally handled by the existing `calls()` entry point: `calls(p).that().withMethod('catch').should().haveCallbackContaining(...)`.
3. The detection logic (check if callback parameter is referenced) would be different — the callback is an arrow/function expression, not a catch clause.

A future `noSilentPromiseCatch()` rule could reuse parts of `findSilentCatches`'s Identifier walk, but it belongs in a separate condition file and uses a different entry point. Not blocked by this plan.

### Catch variable re-assignment

`catch (err) { err = new Error('replaced'); throw err }` — the original error IS silently discarded (replaced with a new one), but the rule sees `err` referenced (the assignment target) and passes. Detecting this would require data-flow analysis: tracking that the original binding value is overwritten before any read. This is beyond AST structural analysis and enters the territory of abstract interpretation. Documented as a known limitation in the JSDoc.

### Scope-aware Identifier resolution

The simple Identifier name-matching walk has two false-negative edge cases (variable shadowing, nested same-name catches — see Known Limitations below). Fixing these would require resolving each Identifier to its declaration and checking it matches the catch clause's binding. Options considered:

1. **`findReferencesAsNodes()`** — the Language Service approach. Handles scoping correctly but: returns zero refs for destructured bindings (critical bug), can throw on edge cases, and is a whole-program operation (expensive per catch clause). Rejected during review.
2. **Manual scope resolution** — walk from the Identifier up to its declaration, compare with the catch binding. Correct but complex to implement (must handle block scoping rules, `var` vs `let`/`const`, function boundaries). Deferred — the false negatives are extremely rare in practice and the affected patterns (variable shadowing inside a catch block, nested catch with identical binding names) are themselves code smells.

The tradeoff is: zero false positives with rare false negatives > occasional false positives from an expensive analysis.

### Module variants for existing error rules

`moduleNoGenericErrors` / `moduleNoTypeErrors` are intentionally absent from `errors.ts`. Adding `moduleNoSilentCatch` is justified because silent catches are dangerous at any scope level (module-level try/catch wrapping initialization code, top-level await error handling). In contrast, `new Error()` in module-level code is rare — most Error construction happens inside functions. This inconsistency is acceptable and documented.

## Known limitations (false negatives)

These are inherent to the simple Identifier walk approach. Both are extremely rare in practice and arguably code smells themselves. Documented in `catch-analysis.ts` JSDoc.

- **Variable shadowing:** `catch (err) { const err = new Error('replaced'); throw err }` — the `err` Identifier matches but refers to the redeclared variable. The original error is silently discarded but the rule sees a reference.
- **Nested catch with same binding name:** `catch (err) { try { b() } catch (err) { log(err) } }` — the inner `err` usage (a descendant of the outer block) satisfies the outer check. The outer error is silently discarded.

Fixing these would require scope-aware analysis (checking which declaration each Identifier resolves to). The `findReferencesAsNodes()` approach could theoretically solve this but has its own problems (returns zero refs for destructured bindings, throws on some node types, expensive whole-program operation). The tradeoff is: zero false positives with rare false negatives > occasional false positives from an expensive analysis.

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
