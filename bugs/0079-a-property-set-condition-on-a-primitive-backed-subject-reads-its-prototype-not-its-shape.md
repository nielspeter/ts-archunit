# Bug 0079: a property-set condition on a primitive-backed subject reads its prototype, not its shape

**Reported:** 2026-08-12 · **Fixed:** not yet
**Found in:** the five-persona review of [bug 0078](./0078-a-property-condition-on-a-propertyless-subject-cannot-fail-and-nothing-says-so.md).
0078 originally claimed its vacuous-pass hazard extended "by extension" to `havePropertyNamed`,
`havePropertyMatching`, `haveOnlyReadonlyProperties`, and `maxProperties`. Three independently-run
reviewers (architect, testing, and product personas), using different methods — reading the source,
probing ts-morph live, reading the source a second way — converged on the same correction while
checking that claim: it doesn't hold, and what these conditions actually have is a related but
different defect, verified here.
**Severity:** Medium. Same published-API class as 0078 — first-party `should()` conditions on
`types()`/`classes()`, in `src/conditions/members.ts` — six exported functions rather than one. See
Severity below for why the corpus-independent slice is narrower than 0078's for most of this family.

## Relationship to 0078 — the correction that produced this bug

0078's `havePropertyType` does a **targeted lookup** — `type.getProperty(name)` — that is correctly
`undefined` for a subject whose type can never carry `name`, and the condition skips such a subject
unconditionally. This bug's mechanism is different, even though the affected functions live in the same
condition family and look superficially similar from the outside.

## The mechanism

`havePropertyNamed`, `notHavePropertyNamed`, `havePropertyMatching`, `notHavePropertyMatching`,
`haveOnlyReadonlyProperties`, and `maxProperties` (`src/conditions/members.ts:89-287`) all resolve their
subject's properties through one shared helper:

```ts
// src/conditions/members.ts:22-24
function getPropertySymbols(node: PropertyBearingNode): TsSymbol[] {
  return node.getType().getProperties()
}
```

`PropertyBearingNode` is `InterfaceDeclaration | TypeAliasDeclaration | ClassDeclaration`
(`src/conditions/members.ts:16`) — nothing restricts the `TypeAliasDeclaration` case to a type that is
actually object-shaped. When a type alias resolves to a primitive or a closed union of literals — 0078's
exact `*OrderByColumn` shape — `getType().getProperties()` does not return the declaration's own shape.
It returns the **boxed prototype's** members, because that is what TypeScript resolves a member access
on such a type to: `String.prototype` for a string-literal union or a `string` alias, `Number.prototype`
for a `number` alias, and so on. The helper's name — "property symbols" — describes what the author
intended to read (the declared shape); what it actually reads, for these subjects, is the ambient JS
runtime prototype the type happens to widen to.

## Measured

Against an in-memory fixture reproducing 0078's exact motivating type, run live through the shipped
condition functions (ts-morph 27, this repo's own `src/conditions/members.ts`):

```ts
export type WebhookOrderByColumn = 'created_at' | 'updated_at' | 'name'
```

| probe | result |
| --- | --- |
| `WebhookOrderByColumn.getType().getProperties().length` | **21** — `toString`, `charAt`, `charCodeAt`, `concat`, `indexOf`, `lastIndexOf`, `localeCompare`, `match`, `replace`, `search`, `slice`, `split`, `substring`, `toLowerCase`, `toLocaleLowerCase`, `toUpperCase`, `toLocaleUpperCase`, `trim`, `length`, `substr`, `valueOf` — every one inherited from `String.prototype`, none declared by the type |
| `(number alias).getType().getProperties().length` | **6**, from `Number.prototype` |
| `havePropertyNamed('orderBy')` on the type above | **fails**: `"WebhookOrderByColumn is missing required property \"orderBy\""` — true, but for a reason unrelated to the rule: no name the author could have picked would ever pass; the check is really "is `orderBy` among 21 unrelated JS builtin method names" |
| `haveOnlyReadonlyProperties()` on the type above | **fails 20 times**: `"...has mutable property \"toString\""`, `"...has mutable property \"charAt\""`, … — one of the 21 (`length`) is genuinely `readonly` on `String.prototype` and is correctly excluded; the other 20 are method signatures, correctly not literal-`readonly`, and each produces a violation naming a JS builtin the rule author never wrote |
| `maxProperties(15)` on the type above | **fails**: `"...has 21 properties, max allowed is 15"` — a size limit meant for interface/DTO sprawl, tripped by prototype noise |
| `maxProperties(25)` on the type above | **passes silently** — 21 ≤ 25. Same subject, same author intent, opposite verdict, purely because the chosen threshold sits above the prototype's member count rather than any property the author declared |
| `havePropertyMatching(/^orderBy$/)` on the type above | **fails**: `"...has no property matching /^orderBy$/"` — no builtin string method happens to match this particular pattern |
| `havePropertyMatching(/^c/)` on the type above | **passes silently, 0 violations** — `charAt` (a `String.prototype` method, not anything the author wrote) matches `/^c/`, so the condition reports "yes, a property matches" and never inspects whether the *intended* property exists |

The last row is the one that matters most: it is 0078's exact failure shape — a rule reads green for a
reason that has nothing to do with what it was written to check — reproduced on a different condition,
through a different mechanism, in one line of test code.

## Why this is a different defect from 0078, not the same one

**0078:** `havePropertyType` reads `undefined` and **skips** the subject — the condition never runs, so
it cannot fail, for every subject of that shape, unconditionally. Corpus-independent, single mechanism,
single direction (always a silent pass).

**0079:** the six `members.ts` conditions read a **non-empty, wrong-domain** property set — the
subject's verdict now depends on whether the requested name, pattern, or threshold happens to collide
with one of the JS prototype's own member names or count, which varies by:

- which primitive the alias resolves to (`string` → 21, `number` → 6, and unmeasured here: `boolean`,
  `bigint`, `symbol`, template-literal types, and mixed-primitive unions);
- the specific name, pattern, or threshold the rule author chose;
- (for `maxProperties`) a config value the rule author sets per-rule, not something structural to the
  type.

So most of this bug's failure mode is **noisy** (false failures with confusing, JS-builtin-referencing
messages) rather than silent — annoying and misleading, but not the "green means nothing" shape
ADR-008 is written against. The one measured exception, `havePropertyMatching`, **is** that shape: it
can pass silently whenever the pattern is loose enough to catch a builtin name, which is exactly the
kind of pattern (`/^c/`, `/^t/`, `/Name$/` — all plausible author choices) a rule author has no reason to
suspect collides with `String.prototype`.

## Severity

Medium, matching 0078's calibration on the same published-API class (first-party `should()` conditions
under `types()`/`classes()`), with a caveat 0078 didn't need: **this bug's corpus-independent claim is
narrower than 0078's.** `maxProperties`'s pass/fail split is threshold-dependent (config, not
structure) — "the type resolves to a primitive" doesn't by itself decide the verdict the way it does for
`havePropertyType`. Only the `havePropertyMatching` row is corpus-independent in 0078's sense: any
pattern that matches a name in the resolved prototype's member set will silently pass, regardless of
corpus, for as long as the subject resolves to that prototype.

## What this does not claim

- Not a claim that `ts-morph`/TypeScript are wrong. Widening a literal-union or primitive-aliased
  member access to its boxed prototype is correct, standard TS/JS semantics — `getProperties()` answers
  the question it was asked faithfully. The defect is that `getPropertySymbols()` (this library's own
  helper) asks that question of subjects it was never meant to be pointed at, with no guard.
- Not measured beyond `string` and `number` aliases and one literal union. `boolean`, `bigint`,
  template-literal types, mixed-primitive unions, and the `ClassDeclaration` branch of
  `PropertyBearingNode` are unmeasured here — plausibly the same shape, not verified.
- Not a claim that this is common in real corpora. No frequency measurement was done; 0078's own
  motivating example is the only known real occurrence, and it hit `havePropertyType`, not one of these
  six.
- Not proposing an implementation. The obvious guard — reject or warn when `PropertyBearingNode`
  resolves to a non-object type before calling `getProperties()`, or restrict the predicate layer that
  feeds these conditions to subjects with a real declared shape — is exactly the kind of one-instance
  generalisation 0078's own closing warning is about, and this bug is itself evidence for that warning:
  0078 generalised from one measured case to four unmeasured ones and was wrong about three of them.
  Whoever fixes this should re-derive the guard from measurement, not from this bug's prose.

## For the record — how this was found

Not by inspection and not by mutation testing against a real defect — by a five-persona review of 0078
independently checking whether its "by extension" claim held, with three of five reviewers landing on
the same correction by different methods. The `havePropertyMatching(/^c/)` silent-pass row above was
not anticipated by any reviewer's prose — it was found by writing the probe the correction required and
running it, which is the same lesson 0078's own closing section draws about `examined: 0 → 9`: the count
moving, or the source reading plausible, is not the same as running it.
