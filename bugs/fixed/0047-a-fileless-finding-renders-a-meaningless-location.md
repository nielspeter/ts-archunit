# Bug 0047: a fileless finding renders a meaningless location

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01, released in **v0.39.0**
**Found in:** v0.36.3, by the customer review of the 0041/0042 branch
**Severity:** Low, and filed only because the affected path is the agent's. Deliberately deferred
from the v0.37.0 release as cosmetic; recorded here rather than dropped.

## Description

Configuration findings carry no source location — they report that a _rule_ enforces nothing, not
that a line of code is wrong — so they set `file: ''` with `line: 0` or `line: 1`. The rich
terminal formatter handles this correctly and omits the location entirely.

The other two renderers do not:

- `formatViolationsPlain` emits a trailing `(:1)` — or `(:0)` — with no filename.
- `--format json` emits `"file": "", "line": 1`.

A human skims past `(:1)`. An agent parsing the JSON gets a location that looks real, is not, and
may be used to open a file or anchor an edit.

## Scope

Pre-existing and shared by every `bypassFilters` producer — there are twelve. Not introduced or
widened by any recent change; the v0.37.0 review simply noticed it.

## Fix

Two candidate shapes, and the choice matters more than the code:

1. **Omit the fields.** `file: null, line: null` in JSON, no `(:1)` in plain. Cleanest to read,
   but it changes a documented payload shape, and a consumer indexing on `file` gets `null` where
   it previously got `''`.
2. **Keep them and add a discriminator.** The JSON already distinguishes these findings — a
   `configuration: true` flag, or reuse of the existing `bypassFilters` semantics — so a consumer
   can be told to ignore the location rather than having it removed.

(2) is likely right: `--format json` is the agent contract, and additive beats breaking. Settle it
before writing code.

## Guard

- a configuration finding rendered plain contains no `(:` fragment;
- the same finding in JSON is distinguishable from a real one without inspecting `file`;
- **control**: an ordinary violation still renders its real `file:line` in both formats;
- vacuity: the fixture actually produces one of each.

## Related

- [Plan 0078](../../plans/0078-derive-the-configuration-finding-census.md) — the census over the
  twelve producers; this is a rendering property of the same population, and the census is the
  natural place to assert it uniformly.

## Fix as shipped

The bug proposed two options and the answer was **both**, because either alone makes things
worse. Nulling the location without adding a discriminator removes the only signal — misleading
though it was — that a consumer had for telling the two kinds apart. Adding a discriminator
without nulling the location leaves the fake location in place.

- **Plain** omits the location when `file === ''`.
- **JSON** emits `file: null, line: null`, consistent with how that document already nulls every
  other absent value.
- **`kind: 'violation' | 'configuration'`** replaces the boolean the first draft shipped.
- **`ArchJsonReport` and friends are exported**, so the document is a type rather than folklore.

### Why `kind`, not `configuration: boolean`

Review made the case better than the one I had. **The third kind already exists**, and the
boolean was flattening it — `configuration: true` covers four different remedies:

| Producer                                                      | What to do                   |
| ------------------------------------------------------------- | ---------------------------- |
| `rule-builder.ts` — matched nothing / asserts nothing         | edit the rule                |
| `rule-file-findings.ts:61` — the file could not be evaluated  | fix a syntax or import error |
| `rule-file-findings.ts:145` — rules after a failure never ran | coverage gap, re-run         |
| `baseline.ts` — matched 0 of N entries                        | regenerate the baseline      |

A boolean can never split those; a string widens without breaking, provided consumers treat an
unrecognised value as `'violation'` — which the exported type's docstring now says. The repo
already uses `kind` for this job on `DiagnosticFinding`.

## A release blocker the review caught in my own docs

The agent page said `file` and `line` are `null` and told the reader **"Do not open them."**
Wrong for the common case, and measured: `attributeToRuleFile`
(`cli/rule-file-findings.ts:35`) rewrites `file: ''` to the **rule file** with `line: 1` at
`check.ts:98`, while `filterNew` runs at `:111` — so only the baseline meta-findings reach the
formatter unattributed. Most configuration findings carry a real, useful path, and bug 0026
added that address deliberately.

Worse than unhelpful: an agent following the page and testing `file === null` to detect a
configuration finding would misclassify every attributed one. The page now says to detect by
`kind`, and that a non-null `file` is the rule file rather than the code under test.

## Guard and sabotage — 6 rows, and the two that mattered were mine

`tests/core/a-fileless-finding-has-no-location.test.ts`. Every row caught **after** a correction
the sabotage forced:

| Revert                                     | Result |
| ------------------------------------------ | ------ |
| plain renders the location unconditionally | CAUGHT |
| plain drops it unconditionally             | CAUGHT |
| JSON keeps the empty `file`                | CAUGHT |
| JSON keeps the bogus `line`                | CAUGHT |
| `kind` always `'configuration'`            | CAUGHT |
| `kind` always `'violation'`                | CAUGHT |

**The first two were GREEN on the first run.** The test called
`formatViolations([CONFIG], 'plain')` — and that function's second parameter is `reason`, not a
format. It passed `'plain'` as a reason, exercised the **rich** formatter, which already handled
fileless findings correctly, and asserted nothing about the code being fixed.

That is the second time in one session a probe was pointed at a neighbour of the mechanism
rather than the mechanism itself (the other: an `.asSeverity('warn')` probe aimed at
`applyFilters` instead of `severityFor`). Neither was visible from the test passing; both were
found only by reverting the fix and seeing green. The guard now calls `formatViolationsPlain`
directly, and carries a control asserting the rich formatter still omits the location — since
that is what made the mistake invisible.

The exported type is pinned against the emitter's actual output, so the contract and the payload
cannot drift.

## Related

- [Bug 0026](./0026-a-location-less-finding-does-not-say-which-rule-file-it-came-from.md) — why
  configuration findings carry the rule file, which is what made the first docs draft wrong.
- [Plan 0078](../../plans/0078-derive-the-configuration-finding-census.md) — the census over the
  same twelve producers; rendering uniformity belongs there.
