# Bug 0015: `onlyImportFrom` passes on a file with no imports, however broken the allowlist

**Reported:** 2026-07-25
**Found in:** all versions through v0.19.0
**Severity:** Medium — the allowlist family is silent exactly where an allowlist matters most, and one of the two affected conditions documents the behaviour without treating it as a defect.

## Description

The `only*` family constrains **edges**, not subjects. Each iterates a subject's
imports (or importers) and reports a violation per edge that falls outside the
allowlist. A subject with **zero edges** therefore has nothing to violate and
passes, no matter what the allowlist says — including when the allowlist is a
typo that matches nothing.

Measured against a single file containing no imports at all:

```
subjects selected                                     1
onlyImportFrom('**/nowhere/**')  (broken allowlist)   0 violations
```

Affected:

| Site                                       | Note                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/conditions/dependency.ts:63`          | `onlyImportFrom` — iterates `sf.getImportDeclarations()`                               |
| `src/conditions/dependency.ts:233`         | `onlyHaveTypeImportsFrom` — same shape                                                 |
| `src/conditions/reverse-dependency.ts:146` | `onlyBeImportedVia` — **documents it**: _"Modules with zero importers pass vacuously"_ |

## Why it matters more than the count suggests

The shape it fails on is not an edge case, it is the target case. In a layered
architecture the **innermost layer** — domain, entities, core — is the one an
allowlist is written to protect, and it is characteristically the layer with the
fewest outbound imports. A `domain/` module with no imports yet passes
`onlyImportFrom(...)` unconditionally, so the rule certifies nothing precisely
where the architecture most depends on it.

The existing comment at `reverse-dependency.ts:146` is honest about the mechanism
and silent about the consequence: passing vacuously is recorded as behaviour, not
as a gap.

## Why plan 0069 does not close it

[Plan 0069](../plans/0069-no-rule-may-certify-nothing.md) guards globs that cannot
match the project. This is a different failure: the glob may be perfectly
satisfiable and the rule still certifies nothing, because the **subject has no
edges to test**. A typo'd allowlist glob is the loud case — every import falls
outside it, so every import violates. The silent case is the edgeless subject,
which no glob check can see.

Filed separately, at review's insistence, so it does not live only inside a plan
that eventually moves to `plans/completed/`.

## Suggested fix

Two candidates, both needing a decision rather than just code:

1. **An edge-count assertion**, symmetric with `.expectNonEmpty()` for subjects —
   opt-in, so a genuinely import-free module stays green when that is intended.
2. **Report the edgeless subject count** in `explain` / `--format json`, so a
   reader can see that a rule ran over N subjects and tested 0 edges. Diagnostic
   rather than gate; cheaper, and it composes with plan 0069's reporting.

Option 1 is the enforcement answer and repeats the opt-in mistake plan 0069
exists to correct. Option 2 is honest but does not fail. Deciding between them
should wait until 0069's reporting surface exists, so this bug does not invent a
third mechanism.

## Consequence for plan 0069's claims

R3's changelog must scope its claim to **path globs**. "Rules that enforce
nothing now fail" would be false while this is open, and the counter-example
sits in the canonical layered-architecture rule.
