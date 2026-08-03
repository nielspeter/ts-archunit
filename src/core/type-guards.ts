/**
 * The narrowings this codebase needs at its JS-interop edges, in one place.
 *
 * [ADR-005](../../adr/005-no-any-no-type-assertions.md) forbids `as` and
 * prescribes type guards. The guards existed — `isRecord` was written **twice**,
 * verbatim, in `tsconfig/tsconfig-builder.ts` and `cli/commands/init.ts` — while a
 * third site cast instead of calling either.
 * [Bug 0049](../../bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md).
 *
 * A duplicated predicate is not a style problem in this repo: bug 0044 was a
 * measurement error caused by exactly that, and the fix was to delete the
 * duplicate rather than to test both copies.
 */

/**
 * A plain object, indexable by string.
 *
 * Excludes `null`, which `typeof` does not — and excludes **arrays**, which is
 * load-bearing rather than tidy. Both retired copies had `!Array.isArray(value)`
 * and the first draft of this shared one did not, which would have quietly
 * widened `tsconfig-builder`'s deep-compare and `init`'s tsconfig reader to accept
 * an array as a record. Consolidating two copies means picking one, and picking
 * the weaker one is how a refactor becomes a defect.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A value that can be called with no arguments.
 *
 * Narrower than it looks, and deliberately so: the return type is `unknown`, so
 * every caller has to establish what came back rather than inheriting a claim.
 *
 * This exists because *removing* a cast is not automatically an improvement.
 * Dropping `(exported as () => unknown)()` after a `typeof === 'function'` check
 * left `exported` typed as `Function`, which trades an ADR-005 violation for an
 * `@typescript-eslint/no-unsafe-call` error — the same unchecked call, differently
 * spelled. A predicate narrows to a signature and satisfies both.
 */
export function isNullaryCallable(value: unknown): value is () => unknown {
  return typeof value === 'function'
}
