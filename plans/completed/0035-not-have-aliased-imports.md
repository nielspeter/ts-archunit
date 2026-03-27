# Plan: Add `notHaveAliasedImports()` module condition

## Context

BUG-0007 exposed that `import { not as notType }` aliases hide API design problems. Now that the unified combinators fix the root cause, we want to enforce "no aliased imports" as an architectural rule — both to dogfood ts-archunit and to catch future alias drift. Currently there's no built-in condition to detect `import { x as y }` patterns.

## Implementation

### 1. Add condition in `src/conditions/dependency.ts`

New function following the exact pattern of `onlyHaveTypeImportsFrom`:

```typescript
export function notHaveAliasedImports(): Condition<SourceFile> {
  return {
    description: 'not have aliased imports',
    evaluate(sourceFiles, context) {
      const violations = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          for (const specifier of decl.getNamedImports()) {
            if (specifier.getAliasNode()) {
              // specifier.getName() = original, specifier.getAliasNode().getText() = alias
              violations.push(
                importViolation(
                  sf,
                  decl,
                  `${sf.getBaseName()} aliases "${specifier.getName()}" as "${specifier.getAliasNode().getText()}"`,
                  context,
                ),
              )
            }
          }
        }
      }
      return violations
    },
  }
}
```

No glob parameter — this is a blanket rule like `notExist()`. If you only want to check certain imports, filter with `.that().importFrom(...)` predicates.

### 2. Wire into builder in `src/builders/module-rule-builder.ts`

Import and add method:

```typescript
notHaveAliasedImports(): this {
  return this.addCondition(notHaveAliasedImportsCondition())
}
```

### 3. Export from `src/index.ts`

Add `notHaveAliasedImports` to the dependency conditions export block.

### 4. Add arch rule in `tests/archunit/arch-rules.test.ts`

Dogfood it:

```typescript
it('test files should not use aliased imports from internal modules', () => {
  modules(p)
    .that()
    .resideInFolder('**/tests/**')
    .should()
    .notHaveAliasedImports()
    .because('unified combinators make aliases unnecessary — use real names')
    .check()
})
```

### 5. Test the condition in `tests/conditions/dependency.test.ts`

Add unit tests using a fixture file with aliased imports.

## Files changed

- `src/conditions/dependency.ts` — add `notHaveAliasedImports()`
- `src/builders/module-rule-builder.ts` — add builder method
- `src/index.ts` — add export
- `tests/archunit/arch-rules.test.ts` — dogfood rule
- `tests/conditions/dependency.test.ts` — unit tests
- `tests/fixtures/` — small fixture file with aliased imports

## Verification

1. `npm run typecheck` — clean
2. `npx vitest run tests/conditions/dependency.test.ts` — new tests pass
3. `npx vitest run tests/archunit/arch-rules.test.ts` — dogfood rule passes (no aliases left)
4. `npx vitest run` — full suite green
