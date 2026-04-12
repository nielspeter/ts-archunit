# Proposal: Per-Rule Exclusions

**In response to:** Feature Request — Per-rule file/function exclusions
**Date:** 2026-03-26
**Status:** Proposal

---

## Summary

Add two complementary mechanisms for permanent, intentional exceptions to architecture rules:

1. **Inline comments** (`// ts-archunit-exclude`) — exclusion lives with the code
2. **`.excluding()` chain method** — exclusion lives with the rule

Both address the same gap: the space between `.warn()` (never enforced) and `.check()` (no exceptions).

---

## The Problem (agreed)

The feature request correctly identifies that baseline mode and exclusions serve different purposes:

|                   | Baseline                                   | Exclusion                             |
| ----------------- | ------------------------------------------ | ------------------------------------- |
| **Intent**        | "We'll fix this"                           | "This is intentionally different"     |
| **Trend**         | Decreases over time → ratchet to zero      | Permanent — stays forever             |
| **Documentation** | Generated, not authored                    | Must explain why the exception exists |
| **Mixing them**   | Makes it impossible to tell which is which | —                                     |

Without exclusions, rules with even one intentional exception can never be enforced with `.check()`.

---

## Approach 1: Inline Comments (recommended for v1)

```typescript
// ts-archunit-exclude sdk/no-manual-urlsearchparams: builds image transform URL, not list pagination
async getImageUrl() {
  const params = new URLSearchParams()  // ← not flagged
}
```

### How it works

1. The developer adds `// ts-archunit-exclude <rule-id>: <reason>` above the violating code
2. During rule evaluation, ts-archunit scans the source file for exclusion comments
3. If a violation's line is covered by an exclusion comment matching the rule ID, the violation is suppressed
4. The reason after `:` is **required** — undocumented exclusions are rejected

### Why inline comments

| Property                  | Inline comment                      | .excluding() on chain       | Exclusion file              |
| ------------------------- | ----------------------------------- | --------------------------- | --------------------------- |
| Survives refactoring      | ✅ Moves with the code              | ❌ Element rename breaks it | ❌ Element rename breaks it |
| Visible when reading code | ✅ Right there                      | ❌ In test file, elsewhere  | ❌ In separate file         |
| Familiar pattern          | ✅ Every dev knows `eslint-disable` | ⚠️ New concept              | ⚠️ New concept              |
| Forces documentation      | ✅ Reason is required               | ⚠️ Optional                 | ⚠️ Optional                 |
| Auditable                 | ✅ `grep ts-archunit-exclude`       | ✅ In test file             | ✅ In one file              |

### Syntax

```typescript
// Single-line: exclude the next statement
// ts-archunit-exclude sdk/no-manual-urlsearchparams: image transform URL params
const params = new URLSearchParams()

// Block: exclude a range
// ts-archunit-exclude-start sdk/no-manual-urlsearchparams: sync token has unique semantics
async sync() {
  const params = new URLSearchParams()
  params.append('sync_token', token)
  params.append('initial', String(isInitial))
}
// ts-archunit-exclude-end

// Multiple rules on one line
// ts-archunit-exclude sdk/no-manual-urlsearchparams, repo/no-parseint: legacy compatibility
```

### Rule ID requirement

Exclusion comments reference the rule by its `.rule({ id })` value. Rules without an ID cannot be excluded — this incentivizes teams to assign IDs to all enforced rules.

```typescript
// In the arch test:
.rule({ id: 'sdk/no-manual-urlsearchparams' })

// In the source code:
// ts-archunit-exclude sdk/no-manual-urlsearchparams: reason here
```

### Reason requirement

The reason after `:` is mandatory. An exclusion without a reason is reported as a violation itself:

```
Architecture Warning: undocumented exclusion

  src/wrappers/asset.ts:42
  // ts-archunit-exclude sdk/no-manual-urlsearchparams

  Fix: Add a reason — // ts-archunit-exclude sdk/no-manual-urlsearchparams: <why this is OK>
```

---

## Approach 2: `.excluding()` Chain Method (complementary)

For cases where inline comments aren't practical (e.g., generated code, third-party files you can't modify):

```typescript
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync')
  .rule({ id: 'sdk/no-manual-urlsearchparams' })
  .check()
```

### How it works

1. `.excluding(...names)` filters violations by element name before `.check()` throws
2. Names are matched against `violation.element` (e.g., `Asset.getImageUrl`, `OrderService.query`)
3. Supports exact strings and regex: `.excluding(/^Asset\./, 'Environment.sync')`

### Limitation: fragile on rename

If `Asset.getImageUrl` is renamed to `Asset.buildImageUrl`, the exclusion silently stops matching. The previously-excluded violation reappears in CI — which is actually **correct behavior** (renamed code should be re-evaluated). But it can be surprising.

Mitigation: when an exclusion matches zero violations, emit a warning:

```
Architecture Warning: unused exclusion 'Asset.getImageUrl' in rule sdk/no-manual-urlsearchparams
  This exclusion didn't match any violations. It may be stale after a rename.
```

---

## Implementation Plan

### Phase 1: `.excluding()` chain method (simplest, highest impact)

- Add `_exclusions: (string | RegExp)[]` to `RuleBuilder`
- Add `.excluding(...patterns)` method that populates `_exclusions`
- In `evaluate()`, filter out violations where `violation.element` matches any exclusion
- Emit warning for unused exclusions (exclusion that matched zero violations)
- Copy `_exclusions` in `fork()` for named selection support
- Also add to `SliceRuleBuilder`

**Effort:** 0.5 day
**Files:** `src/core/rule-builder.ts`, `src/builders/slice-rule-builder.ts`, tests

### Phase 2: Inline exclusion comments

- Before evaluating conditions, scan source files for `// ts-archunit-exclude` comments
- Parse comment: extract rule ID + reason
- During violation collection, check if the violation's file + line is covered by an exclusion comment matching the current rule ID
- Validate: reject exclusions without reasons, warn on unused exclusions

**Effort:** 1-2 days
**Files:** `src/helpers/exclusion-comments.ts`, updates to `RuleBuilder`, tests

### Phase 3: Audit report

- `npx ts-archunit audit` lists all exclusions (both inline comments and `.excluding()` chains)
- Shows: rule ID, element, file, reason, type (inline/chain)
- Useful for periodic review: "are these exclusions still justified?"

**Effort:** 0.5 day (after CLI plan 0020 is complete)

---

## Interaction with Existing Features

| Feature                  | Interaction                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `.check()`               | Exclusions filter violations before throwing                                                                                                |
| `.warn()`                | Exclusions filter violations before logging                                                                                                 |
| `withBaseline()`         | Baseline applies first, then exclusions. Baseline is for temporary violations, exclusions for permanent ones.                               |
| `diffAware()`            | Diff filter applies after exclusions. A new violation in a changed file is reported even if other violations in the same file are excluded. |
| `.rule({ id })`          | Rule ID is required for inline exclusion comments. `.excluding()` works without a rule ID.                                                  |
| `detectFormat('github')` | Excluded violations don't produce GitHub annotations. Unused exclusion warnings do.                                                         |

---

## What We're NOT Doing

- **Per-file exclusions** — use predicates: `.that().resideInFolder()` already filters files
- **Exclusion config file** — adds another file to manage. Inline comments + `.excluding()` cover all cases.
- **Auto-generating exclusions** — exclusions are intentional decisions, not generated output. Baseline mode handles the "generate and ratchet" workflow.
- **Exclusion inheritance** — no `extends` for exclusion lists. Each rule manages its own.

---

## Recommendation

**Ship Phase 1 first** (`.excluding()` chain method). It covers the three cases from the feature request immediately:

```typescript
// SDK wrappers — exclude known thin wrappers
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync')
  .check() // ← now enforced

// Route imports — only type imports from repositories
modules(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .onlyHaveTypeImportsFrom('**/repositories/**')
  .excluding('internal-routes')
  .check() // ← now enforced

// Repository base class — all repos must extend BaseRepository
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .should()
  .shouldExtend('BaseRepository')
  .excluding(/Helper$/, /Mixin$/)
  .check() // ← now enforced
```

Phase 2 (inline comments) follows when teams need code-level exclusions.
