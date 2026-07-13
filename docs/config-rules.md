# Project-Config Rules — `tsconfig()`

Every code-level rule in ts-archunit — `noTypeAssertions`, `noNonNullAssertions`, the escape-hatch matchers — assumes the project's TypeScript strict flags are actually on. Nothing stops a teammate from flipping `strict: false` during a refactor to make `tsc` green; the build passes, the code-level rules keep passing (they inspect code `tsc` already let slide), and the drift goes unnoticed.

`tsconfig()` closes that upstream hole. It asserts that the project's **resolved** compiler options match a spec you supply:

```typescript
import { project, tsconfig } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

tsconfig(p)
  .requires({ strict: true, noUncheckedIndexedAccess: true })
  .because('ADR-001 requires strict mode')
  .check()
```

Call `.check()` inside a vitest/jest test, like every other rule (or spread the builder into a CLI rule file — see [In a rule file](#in-a-rule-file)).

It is a generic primitive, not an opinion: you declare the shape your project wants. A strict greenfield, a partial migration, or a JS-mostly repo all use the same rule to assert whatever they actually intend.

## Strict-family resolution — why this isn't a JSON-schema check

The one thing a plain "does the JSON have this key" check gets wrong: `strict: true` turns on nine sub-flags **implicitly**. `getCompilerOptions()` returns them _unset_ when only `strict` is present — exactly as `tsc` stores them — and resolves each at type-check time via `getStrictOptionValue`. `tsconfig()` mirrors that resolution.

So requiring a strict-family flag passes when `strict: true` is on, even though the sub-flag is never written:

```typescript
// tsconfig.json has { "strict": true } and nothing else.
tsconfig(p).requires({ strictNullChecks: true }).check() // ✅ passes — implied by strict
```

...but an **explicit override wins**, because that's what `tsc` does:

```typescript
// { "strict": true, "strictNullChecks": false }
tsconfig(p).requires({ strictNullChecks: true }).check() // ❌ fails — override turned it off
```

The nine strict-family flags: `alwaysStrict`, `noImplicitAny`, `noImplicitThis`, `strictBindCallApply`, `strictBuiltinIteratorReturn`, `strictFunctionTypes`, `strictNullChecks`, `strictPropertyInitialization`, `useUnknownInCatchVariables`.

Flags **outside** the strict family (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target`, …) are **not** implied by `strict` — they must be set explicitly, and the rule requires them explicitly.

## The spec is your own data

`.requires()` takes `Partial<CompilerOptions>` — ts-morph's own type, re-exported from the TypeScript compiler. You get full autocompletion and type-checking, and new flags from future TypeScript versions are available automatically, with no hand-curated allowlist in this library.

```typescript
import { ScriptTarget, ModuleKind } from 'ts-morph'

tsconfig(p).requires({ target: ScriptTarget.ES2022, module: ModuleKind.Node16 }).check()
```

Enum-backed options (`target`, `module`, `moduleResolution`) are compared by value and printed by **name** in violation messages (`required ES2022, actual ES2020`), not their raw numeric enum value.

## Behavior notes

- **One violation per mismatched flag.** The flag name is the violation's `element`, so `.excluding('strictNullChecks')` filters that flag — and the rule composes with `.because()`, `.rule()`, `.asSeverity()`, `.warn()`, baseline, and diff-aware mode like every other rule.
- **`extends` is resolved.** The rule sees the fully-merged options, so a strict flag inherited from a base config counts.
- **Arrays and objects are deep-compared** (`lib`, `types`, `paths`), not reference-compared.
- **`.requires()` merges.** Multiple calls accumulate; later keys win on conflict.
- **`workspace()` asserts the primary tsconfig.** A workspace uses the alphabetically-first tsconfig's compiler options, so `tsconfig(ws)` asserts against that one config. For per-package strictness in a mixed monorepo, load the package directly: `tsconfig(project('./packages/x/tsconfig.json'))`.
- **Violations reference the config file, not a specific line.** The resolved options are a flat object with no source position, so each violation points at the tsconfig path (line 1), not the offending JSON line.

## `.requires()` asserts an exact value — including `false`

`.requires({ key: value })` asserts the resolved option **equals** `value`. For the strict family, "resolved" means through `strict` (above). For every other option, it's the value literally present in the resolved config — and **unset is not `false`**:

```typescript
// project never sets skipLibCheck (absent)
tsconfig(p).requires({ skipLibCheck: false }).check() // ❌ fails — actual is (unset), not false
```

So `.requires()` is the tool for asserting a flag **is set to** a value. To guard that a flag is _never turned on_ regardless of whether it's written, a dedicated `.forbids()` is future work — for now, assert the positive shape you want (`.requires({ strict: true })`) rather than the negative.

## In a rule file

Like any builder, it spreads into a CLI rule file's default export (non-terminal — no `.check()`):

```typescript
export default [tsconfig(p).requires({ strict: true }).asSeverity('error')]
```
