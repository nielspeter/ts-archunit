# Bug 0037: an import glob rejected the relative spelling, and `layeredArchitecture` reported a false red

**Reported:** 2026-08-01
**Fixed:** 2026-08-01, released in **v0.36.2**
**Found in:** v0.36.1, by the architect review of [bug 0033](./0033-assignedFrom-does-not-accept-a-project-relative-glob.md)
**Severity:** High. A **false red** — a violation on a correct architecture, with no configuration finding and a silent `doctor`. For an agent that is worse than a false green: it will edit real imports to satisfy an allowlist that was never going to match.

## Description

Import globs are matched against the **absolute** resolved path, so a project-relative one could never match. `layeredArchitecture`'s `shared` option reaches two different places — `atPath()`, which was normalized in v0.35.0, and `onlyImportFrom(...allowedGlobs)` under `strict: true`, which was not. Measured on `tests/fixtures/presets/layered`, an architecture the suite asserts is correct:

```
shared: ['**/shared/**']   -> 0 violations
shared: ['src/shared/**']  -> 1 violation   preset/layered/innermost-isolation
```

`bypassFilters` unset and `diagnose()` empty, because `diagnose()` exempts condition-position globs by design (0069's decision table) and `import-target` has no path-universe views at all (bug 0014). So nothing in the pre-flight could see it.

v0.36.1's `docs/slices.md` said preset options that name a location accept a relative glob. Half true, and the untrue half was the one that fails loudly.

## Fix

`candidatesFor(specifier, resolvedPath, projectRoot?)` **appends** the resolved path named from the project root, as one more candidate.

Three properties, each guarded:

- **Appended, never prepended.** `[0]` is the primary candidate: violation messages interpolate it and `hashViolation` hashes the message, so putting the relative form first would silently invalidate every baselined dependency finding.
- **Bare specifiers untouched.** They have no `resolvedPath`, and the early return is what keeps `notImportFrom('fastify')` working — bug 0014's whole subject.
- **Containment required.** A target outside the root gets no relative candidate, rather than a path trimmed at whatever position the prefix happened to occur.

The root is the **importing** file's. In a workspace the target may live in another package, whose absolute path is not under that root — then no relative candidate is produced and matching falls back to the absolute form. That is the honest reading: `'src/shared/**'` written in one package means that package's `src/shared`.

## Guard

Four tests in `tests/core/relative-globs-are-uniform.test.ts`: the relative and anchored spellings agree through the real `onlyImportFrom` condition; a bare specifier still yields exactly itself; the primary candidate is unchanged with and without a root; and a target outside the root gets no relative form.

**Sabotage 5 of 5** — candidate not produced, candidate prepended, bare-specifier early return removed, containment dropped, and the conditions not passing the root.

## Related

- [Bug 0014](./0014-bare-package-import-globs-match-nothing.md) — why bare specifiers must survive this.
- [Bug 0035](./0035-a-workspace-has-no-single-root.md) — the root derivation this uses.
- [Bug 0036](../0036-the-relative-glob-audit-is-incomplete.md) — the remaining unaudited surfaces, and why the uniformity guard cannot yet catch a new one.
