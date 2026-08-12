# Bug 0078: a property condition applied to a propertyless subject cannot fail, and nothing says so

**Reported:** 2026-08-12 · **Fixed:** not yet
**Found in:** upgrading an external consumer (cmless) from 0.17.0 → 0.59.0 and mutation-testing the
rules the upgrade turned red. The rule described here was **not** one of them — it was green
throughout, on both of that repo's server workspaces, and had been for its whole life.
**Severity:** Medium. The blast radius is a whole class of user rules that read as enforcing and are
not; the mechanism is a **type-shape mismatch that the library can see**, which is what separates
this from [0077](./0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md) A.

## Relationship to 0077 — this is the mechanisable sub-case it asks for

0077 A establishes that a non-empty `examined` count does not imply falsifiability, and concludes:

> **Why it probably cannot be mechanised.** Falsifiability is a property of the interaction between a
> condition's semantics and a specific corpus, not of a seam. […] someone should check whether a
> cheaper mechanical proxy exists before accepting it.

This is that check, with a positive result for one shape. 0077 A's own example is
**corpus-dependent** — `inconsistentSiblings` could not fail because *this* corpus had no majority to
diverge from; a different corpus makes the same rule falsifiable. The case below is
**corpus-independent**: the condition cannot fail for *any* corpus, because the subjects are types
that structurally cannot carry a property, and the condition asks about a property. No source edit
anywhere can produce a finding.

That distinction is what makes it checkable without solving falsifiability in general.

## What the user wrote

Verbatim from the consumer's suite, guarding SQL-injection surface on list endpoints:

```ts
types(p)
  .that()
  .haveNameMatching(/OrderByColumn$/)
  .should()
  .havePropertyType('orderBy', matching(/^(?!string$)/))
  .rule({
    id: 'rest/typed-orderby',
    because: 'Bare string orderBy passed to SQL .orderBy() is an injection surface',
  })
  .check()
```

The intent is legible and the naming convention is real — the subjects exist:

```ts
export type WebhookOrderByColumn = 'created_at' | 'updated_at' | 'name'
export type ContentTypeOrderByColumn = 'name' | 'created_at' | 'updated_at' | 'cmless_id'
export type ScheduledActionOrderByColumn = 'scheduled_for' | 'created_at' | 'updated_at'
```

Every `*OrderByColumn` is a **union of string literals**. A union of literals has no properties, so
`havePropertyType('orderBy', …)` holds for every subject, always. The author had reached for the
right family and the wrong end of the relation: the `orderBy` **property** lives on the sibling
`*QueryOptions` interfaces, not on the column union those interfaces reference.

## Measured

Against the consumer's real tree, on 0.59.0.

| probe | result |
| --- | --- |
| `examinedUnits()` — Cell workspace | **3** |
| `examinedUnits()` — IG workspace (after the author added unions there) | **9** |
| `diagnose([rule])` | **`[]`** |
| `check()` | passes |
| mutation: `WebhookOrderByColumn = string` | **still passes** |
| mutation: `CapacityTierOrderByColumn = string` | **still passes** |

The two mutations are the point. `= string` is the exact defect the rule names in its own `because`,
introduced directly into a subject the rule examined, and the rule stayed green.

Every existing guard is satisfied, for the same reason 0077's table gives:

| guard | verdict |
| --- | --- |
| the floor (0099) | passes — `examined` is 3 and 9, not 0 |
| `diagnose()` / `doctor` | **silent** — verified, returns `[]` |
| dead-glob diagnosis (0.34) | silent — no glob involved; the predicate is a name regex |
| zero-subjects gate (0.59) | silent — this is exactly the "non-zero" case it defers to |

⚠️ **0.59's gate is what makes this worth filing now rather than a curiosity.** The gate's arrival
caused the consumer to audit their rules and mutation-test the ones it reddened. This rule was
**not** reddened — it looked healthy by every signal the release added — and was found only because
the author mutation-tested a *neighbouring* fix and then, on suspicion, mutated this one too. A user
who trusts the new gate as a completeness signal will conclude the opposite of the truth here.

## Why this shape is detectable

Not proposing an implementation — flagging that the information is present at the seam. **Scoped to
`havePropertyType` only** — see the correction below. An earlier draft of this section listed four
other conditions "by extension"; they don't share this mechanism, and their own, different hazard is
filed separately as [bug 0079](./0079-a-property-set-condition-on-a-primitive-backed-subject-reads-its-prototype-not-its-shape.md).

- the condition does a **targeted lookup**: `havePropertyType(name, …)` calls `type.getProperty(name)`
  and skips the subject when that is `undefined` (`src/conditions/type-level.ts:43-47`) — a per-name
  query, not a property-count query;
- the subject is a resolved `ts-morph` type, and "this type's kind can never satisfy that lookup" is
  directly answerable by **type kind** — a closed union of literals, a primitive alias, and similar —
  **not** by an empty `type.getProperties()`. That call is not empty for these subjects: verified live,
  a string-literal-union alias reports 21 members inherited from `String.prototype`, a `number` alias
  reports 6 from `Number.prototype`. The decidable signal is "no source edit to this declaration can
  make `getProperty(name)` stop returning `undefined`," not "the apparent property set is empty" —
  conflating the two is exactly the mistake the correction below names;
- ⇒ *`havePropertyType`-by-name ∧ every-examined-subject's-type-kind-cannot-ever-satisfy-that-lookup*
  is a decidable predicate over the set the rule already materialises for `examinedUnits()`.

That is one narrow rule, not a falsifiability solver. It would have reported this the day it was
written, for `havePropertyType`. Whether it belongs in `diagnose()` (preview) or the floor (gate), and
whether it generalises to other condition/subject-kind mismatches, is the owner's call —
[ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) is `Proposed` and this is evidence for its
ratification rather than a design.

⚠️ **The generalisation is the trap, and 0077 already names it**: *"inventing a mechanism from the one
instance that bit us is how the four waves in ADR-009's Context table each closed an enumeration and
missed the next family."* One instance is what this is. Worth checking against the other condition
families before anything is built — which is exactly what caught the correction below.

## Correction (2026-08-12) — the "by extension" list was wrong

The section above used to list `havePropertyNamed`, `havePropertyMatching`, `haveOnlyReadonlyProperties`,
and `maxProperties` alongside `havePropertyType` as sharing this bug's vacuous-**pass** hazard "by
extension." Five-persona review of this bug checked that claim against the shipped implementation and
live against ts-morph 27, and it does not hold.

`havePropertyType` (`src/conditions/type-level.ts:43`) is the only one of the five that does the
targeted lookup this bug is about. The other four — six functions, all in `src/conditions/members.ts`
(`havePropertyNamed`, `notHavePropertyNamed`, `havePropertyMatching`, `notHavePropertyMatching`,
`haveOnlyReadonlyProperties`, `maxProperties`) — share one different helper:

```ts
// src/conditions/members.ts:22-24
function getPropertySymbols(node: PropertyBearingNode): TsSymbol[] {
  return node.getType().getProperties()
}
```

`getProperties()` is the **apparent** property set, not a named lookup, and for a primitive-backed
subject it is not empty — it is the boxed prototype's members (verified above: 21 for a string-literal
union, 6 for a `number` alias). So these six do not vacuously *pass* on this subject shape; most of them
**fail noisily** instead, for reasons unrelated to the rule author's intent (e.g. `haveOnlyReadonlyProperties()`
reports 20 "mutable" violations naming JS builtin methods like `toString`/`charAt` that the author never
wrote). One of them, `havePropertyMatching`, **can** still pass silently — measured: `/^c/` matches the
inherited `charAt` and the condition reports success without ever checking for the author's intended
property. That is a related but structurally different defect — filed separately as
[bug 0079](./0079-a-property-set-condition-on-a-primitive-backed-subject-reads-its-prototype-not-its-shape.md)
rather than folded into this one, per this bug's own warning two paragraphs up: the mechanism this bug
demonstrates is `havePropertyType`'s, not the family's.

## What this does not claim

- Not a defect in any shipped rule or condition. `havePropertyType` behaves as documented; the
  documented "Query Options Must Use Typed Unions" example (`docs/types.md:90`) is correct and is
  what the consumer moved to. The rewritten rule is falsifiable — the same two mutations turn it red.
- Not an argument that `examined` was the wrong seam. 0077's conclusion stands: necessary, not
  sufficient. This adds one sufficient-for-a-subclass check to that discussion.
- Not a claim that falsifiability is mechanisable in general. Explicitly the opposite: this is the
  narrow, structural, corpus-independent slice.

## For the record — how the consumer found it

Mutation, not inspection, and only after a false start worth repeating: the author first "verified"
the rule by observing `examined` go from 0 to 9 after adding the missing types, and was about to
record that as proof. The count moved; the enforcement did not. The mutation was run because the
consumer's own bug template demanded one, and it survived — which is the whole finding in one line.
