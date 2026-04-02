# Bug 0008: `.excluding()` does not work with `satisfy()` conditions

**Reported:** 2026-04-02
**Found in:** v0.7.0
**Fixed in:** v0.7.2
**Severity:** Medium — prevents incremental adoption of `noTypeAssertions()` and similar rules

## Description

When using `classes(p).should().satisfy(condition).excluding('ClassName')`, the `.excluding()` does not filter out violations because the violation `element` field contains the AST node type (e.g., `'AsExpression'`), not the class name. The class name only appears in the `message` field.

## Reproduction

```typescript
classes(p)
  .that()
  .haveNameEndingWith('Service')
  .and()
  .resideInFolder('**/src/services/**')
  .should()
  .satisfy(noTypeAssertions())
  .excluding('AssetService') // ← has no effect
  .rule({ id: 'test' })
  .check()
```

**Expected:** Violations in `AssetService` are excluded.

**Actual:** All violations still reported. The `.excluding('AssetService')` matches against `element: 'AsExpression'`, which never matches.

## Violation output

```
{
  element: 'AsExpression',           // ← excluding matches against this
  file: '.../services/asset.service.ts',
  line: 176,
  message: 'AssetService.getAssetDisplayName uses type assertion — use type guards instead'
  //         ^^^^^^^^^^^^ class name is here, but excluding doesn't check message
}
```

## Affected rules

All `satisfy()` conditions from standard rules that report AST node types as elements:

- `noTypeAssertions()` → element is `'AsExpression'`
- `noNonNullAssertions()` → likely same pattern
- `noEmptyBodies()` → element is `'ClassName.methodName'` (this one works)
- `functionNoConsoleLog()` → element is `'ClassName.methodName'` (works with regex)

## Suggested fix

`satisfy()` conditions should report the **class name** (or `ClassName.methodName`) as the element, not the raw AST node type. This would make `.excluding()` work consistently with how it works for built-in fluent methods like `.shouldExtend()`.

Alternatively, `.excluding()` could match against both `element` and `message` fields.

## Resolution

Fixed in `getElementName()` at the framework level (`src/core/violation.ts`). Inner AST nodes now walk up ancestors to find the nearest structural declaration (method, constructor, getter, setter, property, arrow function variable, class, function). Element names are now qualified: `MyService.doWork`, `Config.constructor`, `Foo.bar`.

The fix benefits ALL conditions that pass inner nodes to `createViolation()`, not just the typescript rules. String exclusion matching remains exact (`===`) — no over-matching risk.
