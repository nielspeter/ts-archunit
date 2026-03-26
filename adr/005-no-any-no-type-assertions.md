# ADR-005: No `any` Types, No Type Assertions

## Status

**Accepted** (March 2026)

## Context

TypeScript's `any` type and type assertions (`as`) bypass the type checker, hiding bugs that strict mode is designed to catch. A library built on the TypeScript compiler should hold itself to the highest type safety standard.

During implementation, we found duck typing patterns (`as Record<string, unknown>`, `as { getName(): string }`) creeping into code that handles ts-morph `Node` subtypes. These are avoidable by using ts-morph's built-in type guard functions (`Node.isClassDeclaration()`, etc.).

## Decision

**No `any` types and no type assertions (`as`) in source code, unless at an unavoidable JS interop boundary.**

### Rules

1. **`any` is banned.** Use `unknown` + type narrowing instead. ESLint `@typescript-eslint/no-explicit-any: 'error'` enforces this.

2. **Type assertions (`as X`) are banned.** Narrow types using:
   - ts-morph type guards: `Node.isClassDeclaration(node)`, `Node.isFunctionDeclaration(node)`, etc.
   - Standard TypeScript narrowing: `typeof`, `instanceof`, `in` operator, discriminated unions
   - Explicit return type annotations instead of `as` on literals (e.g., `[] as SourceFile[]` → annotate the containing function/variable)

3. **Exception: unavoidable JS interop boundaries.** Some JavaScript APIs (`Object.create`, `Object.getPrototypeOf`, `JSON.parse`) return untyped values. When a cast is truly unavoidable:
   - Add `// eslint-disable-next-line` with a comment explaining why
   - Keep the cast as narrow as possible
   - Never suppress `no-explicit-any` — use `unknown` first, then narrow

### Examples

```typescript
// ❌ BAD: duck typing with as
if ('getName' in node && typeof (node as Record<string, unknown>).getName === 'function') {
  const name = (node as { getName(): string | undefined }).getName()
}

// ✅ GOOD: ts-morph type guards
if (Node.isClassDeclaration(node) || Node.isFunctionDeclaration(node)) {
  const name = node.getName()
}

// ❌ BAD: as on array literal
const files = [] as SourceFile[]

// ✅ GOOD: explicit type annotation
const files: SourceFile[] = []

// ❌ BAD: as to force type alignment
return this.addCondition(havePropertyType(name, matcher) as Condition<TypeDeclaration>)

// ✅ GOOD: fix the source type so it aligns
// Import TypeDeclaration from canonical location so types match
return this.addCondition(havePropertyType(name, matcher))

// ⚠️ ACCEPTABLE: unavoidable JS interop with explanation
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const proto: object = Object.getPrototypeOf(this)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const fork: this = Object.create(proto)
```

## Consequences

### Positive

- **Bugs caught at compile time** — the type checker sees the real types, not developer assertions
- **Refactoring safety** — renaming a method on a ts-morph node type produces compile errors everywhere it's used, not silent runtime failures
- **Documentation** — type guards make the code self-documenting about which node types are supported
- **Consistency** — one pattern for handling polymorphic ts-morph nodes across the entire codebase

### Negative

- **More verbose** — `Node.isClassDeclaration(x) || Node.isFunctionDeclaration(x) || ...` is longer than `(x as { getName() }).getName()`
- Mitigation: the verbosity is at specific points (violation helpers, condition implementations), not everywhere. And it's explicit about exactly which types are supported.

- **New ts-morph node types require explicit addition** — if ts-morph adds a new node type with `getName()`, we need to add it to the type guard chain
- Mitigation: this is a feature, not a bug — we explicitly decide which node types we support

## Notes

- `import type` assertions (`as` in import statements, e.g., `import { foo as bar }`) are import renames, not type assertions — they are allowed
- `as const` assertions are allowed — they narrow types, not widen them
- The ESLint rule `@typescript-eslint/no-explicit-any: 'error'` is already configured in `eslint.config.ts`
- Consider adding `@typescript-eslint/no-unsafe-assignment`, `@typescript-eslint/no-unsafe-call`, `@typescript-eslint/no-unsafe-return` to catch `any` propagation from external libraries
