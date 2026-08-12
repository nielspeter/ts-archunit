/**
 * Every configuration-finding producer is accounted for, derived from source —
 * [plan 0078](../../plans/completed/0078-derive-the-configuration-finding-census.md).
 *
 * A finding carrying `bypassFilters: true` reports that a **rule enforces
 * nothing**, and it is unsuppressable by construction. Two invariants are meant
 * to hold across all of them: each carries its own remedy, and each says it
 * cannot be suppressed. Neither was enforced, and both were false somewhere —
 * [bug 0042](../../bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md)
 * shipped a producer printing the rule author's unrelated `Fix:` on a finding
 * about a mis-globbed layer.
 *
 * The guard it replaces enumerated **three** producers by hand and asserted
 * `toBeTruthy()` on their `suggestion` — presence, not correctness. So it could
 * not have caught 0042, and could not fail when the list went stale.
 *
 * ## Keyed on the enclosing function, not the line
 *
 * The plan specified `file:line`, because four files hold two producers each. Line
 * numbers go stale on every edit above them — and this plan's own population
 * count drifted **three times** while it sat open (12 → 13 → 15), which is the
 * argument for deriving rather than transcribing. The enclosing function is
 * stable, and it is what a reader identifies the producer by.
 *
 * ## The scan is complete, and that was checked
 *
 * Every `bypassFilters` occurrence in `src/` is the literal `true` assignment, the
 * type declaration, or a read. No computed writes, no spreads that introduce the
 * flag. Asserted below, so a producer cannot arrive by a route the scan cannot
 * see.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Node, Project, SyntaxKind } from 'ts-morph'

const REPO = path.resolve(import.meta.dirname, '../..')

/**
 * How each producer supplies its remedy.
 *
 * `'own'` — the finding's `suggestion` is written at the producer.
 * `'from-caller'` — the producer takes the remedy as an argument, so the strings a
 * reader actually sees live at its **call sites**, which are checked separately.
 */
interface Classification {
  /** Where the remedy text is written. */
  readonly remedy: 'own' | 'from-caller'
  /**
   * Whether the remedy is **proven to remediate**, per ADR-008 rule 2's
   * behavioural corollary — apply the stated fix and assert the finding clears.
   *
   * `'behavioural'` names the test that does it. `'stated-only'` carries the
   * reason none exists, and is not a free pass: bug 0017 and both of bug 0042's
   * wrong remedies passed every contains-check ever written about them.
   *
   * Not derivable from source, so it is a decision — and the census forces one
   * for every producer, which is the point. A new producer cannot arrive without
   * someone saying whether its remedy has been tried.
   */
  readonly verified: string
}

const CLASSIFIED: Readonly<Record<string, Classification>> = {
  'src/builders/correspondence-builder.ts::emptyViolation': {
    remedy: 'own',
    verified: 'behavioural: correspondence-builder.test.ts — adding .beComplete() clears it',
  },
  'src/builders/correspondence-builder.ts::unboundSideViolation': {
    remedy: 'own',
    verified:
      'behavioural: correspondence-builder.test.ts — correcting the side name clears it (plan 0097)',
  },
  'src/builders/correspondence-builder.ts::unexpectedlyNonEmptyViolation': {
    remedy: 'own',
    verified:
      'behavioural: correspondence-builder.test.ts — removing .expectEmpty(side) clears it (plan 0097)',
  },
  'src/builders/slice-rule-builder.ts::metaViolation': {
    remedy: 'own',
    verified:
      'behavioural: slice-rule-builder.test.ts bug-0009 corpus — each branch reachable only when its advice is true',
  },
  'src/cli/rule-file-findings.ts::ruleFileFailure': {
    remedy: 'own',
    verified:
      'stated-only: the remedy defers to the error named above it, which is arbitrary — no single fix to apply',
  },
  'src/cli/rule-file-findings.ts::ruleFileTruncated': {
    remedy: 'own',
    verified: 'stated-only: same — the remedy defers to the finding above it',
  },
  'src/conditions/cross-layer.ts::unusableLayersFinding': {
    remedy: 'own',
    verified:
      'behavioural: cross-layer-finding-owns-its-remedy.test.ts — supplying the second layer the remedy names clears it; all three conditions asserted, since all three used to return [] silently',
  },
  'src/conditions/cross-layer.ts::emptyLayerFinding': {
    remedy: 'own',
    verified:
      'behavioural: cross-layer-finding-owns-its-remedy.test.ts — fixing the .layer() glob clears it; two earlier remedies were WRONG and passed contains-checks',
  },
  'src/core/execute-rule.ts::applyFilters': {
    remedy: 'own',
    verified:
      'behavioural: exclusion-comments-reach-every-condition.test.ts — adding a reason clears it and keeps the exemption',
  },
  'src/core/rule-builder.ts::emptySelectionViolation': {
    remedy: 'own',
    verified:
      'behavioural: dead-selector-fails.test.ts and the-floor.test.ts — it delegates its text to zeroSubjectsViolation (one text for one state) while keeping its own attribution, and the shared remedy is proven to remediate there',
  },
  'src/core/terminal-builder.ts::zeroSubjectsViolation': {
    remedy: 'own',
    verified:
      'behavioural: the-floor.test.ts — a rule examining zero units fails through violations(), check() and warn(); the empty-project branch never offers a declaration, and a rule that produced a finding passes through untouched',
  },
  'src/core/terminal-builder.ts::expiredDeclarationViolation': {
    remedy: 'own',
    verified:
      'behavioural: the-floor.test.ts — removing the declaration clears it (the stated remedy applied), exactly one finding rather than one per implementation, and the Fix is distinct from the message so format.ts does not drop it',
  },
  'src/core/terminal-builder.ts::collectWithAssertionGuard': {
    remedy: 'own',
    verified:
      'behavioural: assertion-gate.test.ts — adding a condition clears it, plus a control that no remedy names a non-remediating mechanism',
  },
  'src/core/terminal-builder.ts::emptyProjectViolation': {
    remedy: 'own',
    verified:
      'behavioural: assertion-gate.test.ts — the text equals doctor\u2019s, and a loaded project still blames the glob',
  },
  'src/core/terminal-builder.ts::deadSelectorViolation': {
    remedy: 'own',
    verified: 'behavioural: a-dead-discovery-glob-fails.test.ts — a live glob produces no finding',
  },
  'src/smells/inconsistent-siblings.ts::inertViolation': {
    remedy: 'own',
    verified:
      'behavioural: inconsistent-siblings.test.ts — "choose a shared pattern" (the message’s second ' +
      'remedy) clears a REAL inertViolation() (via the EmittingSiblings test-only subclass, since ' +
      'INERT_FINDING_EMIT=false makes this function unreachable through the shipped gate) and replaces ' +
      'it with a normal, real violation (plan 0102; corrected by review to cite the emit-path test, not ' +
      'the preview-only one — the original citation never actually constructed an inertViolation())',
  },
  'src/helpers/baseline.ts::descriptionChangeFinding': {
    remedy: 'own',
    verified: 'behavioural: baseline-description-change.test.ts — regenerating clears it',
  },
  'src/helpers/baseline.ts::unmatchedBaselineFinding': {
    remedy: 'own',
    verified: 'behavioural: baseline.test.ts — a matching baseline produces none',
  },
  'src/presets/shared.ts::declaredEmptyFindings': {
    remedy: 'own',
    verified:
      'behavioural: recommended.test.ts — a declaration naming an off (unconstructed) rule reports, ' +
      'and the carrier itself is proven by declaring a live-glob-zero-subject rule and watching the ' +
      'finding clear, with a one-of-four row so "reached every rule" cannot pass as "silenced everything"',
  },
  'src/presets/shared.ts::overrideFindings': {
    remedy: 'own',
    verified:
      'behavioural: recommended.test.ts — correcting the key clears it, and a correct key takes effect',
  },
  'src/presets/shared.ts::assertEnabled': {
    remedy: 'own',
    verified:
      'behavioural: agent-guardrails.test.ts and data-layer.test.ts (plan 0100) — the truly-minimal ' +
      'call reports it, enabling exactly one flag named in the suggestion clears it, and enabling a ' +
      'flag then overriding it off is a legitimate declaration (UNSUPPRESSABLE’s own text) that ' +
      'never reports it in the first place',
  },
  // Takes `finding.remedy` from its caller, so the text a reader gets is written
  // at each `assertDiscovered(...)` call. Those are asserted separately below —
  // the census would otherwise see one row and never look at the two strings.
  'src/presets/shared.ts::assertDiscovered': {
    remedy: 'from-caller',
    verified:
      'stated-only: the remedy is the caller\u2019s string; boundaries-folder-level.test.ts proves ONE of the two call sites remediates',
  },
}

/** Helper producers whose remedy comes from a caller, and must be followed. */
const REMEDY_HELPERS = ['assertDiscovered'] as const

interface Producer {
  readonly key: string
  readonly file: string
  readonly line: number
}

function loadSource(): Project {
  return new Project({ tsConfigFilePath: path.join(REPO, 'tsconfig.json') })
}

/** The enclosing named function of a node, for a key that survives edits. */
function enclosingName(node: Node): string {
  let current: Node | undefined = node
  while (current) {
    if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) {
      return current.getName() ?? '(anonymous)'
    }
    current = current.getParent()
  }
  return '(file-scope)'
}

function producers(project: Project): Producer[] {
  const found: Producer[] = []
  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(REPO, sourceFile.getFilePath())
    if (!rel.startsWith('src/')) continue
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (assignment.getName() !== 'bypassFilters') continue
      if (assignment.getInitializer()?.getText() !== 'true') continue
      found.push({
        key: `${rel}::${enclosingName(assignment)}`,
        file: rel,
        line: assignment.getStartLineNumber(),
      })
    }
  }
  return found
}

describe('every configuration-finding producer is classified (plan 0078)', () => {
  it('VACUITY: the scan finds producers, and more than one file holds two', () => {
    // A walk that matched nothing would pass every row below. The floor is set
    // beneath the real count so ordinary growth does not trip it, and well above
    // zero so a broken walk cannot pass.
    const found = producers(loadSource())
    expect(found.length).toBeGreaterThanOrEqual(15)

    // The multi-producer files are why a file-keyed table would be a lie about
    // half its sites — the reason this is keyed on the function.
    const perFile = new Map<string, number>()
    for (const p of found) perFile.set(p.file, (perFile.get(p.file) ?? 0) + 1)
    expect([...perFile.values()].filter((n) => n > 1).length).toBeGreaterThanOrEqual(4)
  })

  it('no producer is unclassified', () => {
    // The row that makes this a census rather than a list: a new producer fails
    // the suite until someone decides how it supplies its remedy.
    const unknown = producers(loadSource())
      .map((p) => p.key)
      .filter((key) => !(key in CLASSIFIED))
      .sort()
    expect(unknown, `unclassified producers:\n  ${unknown.join('\n  ')}`).toEqual([])
  })

  it('nothing classified has stopped being a producer', () => {
    // The other direction. A stale entry means the table is describing code that
    // no longer exists, which is how the hand-written list it replaces went wrong.
    const live = new Set(producers(loadSource()).map((p) => p.key))
    const stale = Object.keys(CLASSIFIED)
      .filter((key) => !live.has(key))
      .sort()
    expect(stale, `classified but no longer producing:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('the scan cannot be bypassed: every bypassFilters mention is literal, typed, or read', () => {
    // The census greps for one literal shape. If a producer could set the flag by
    // a computed write or a spread, the census would report full coverage while
    // missing it — the exact shape ADR-008 rule 5 forbids.
    const project = loadSource()
    const suspicious: string[] = []
    for (const sourceFile of project.getSourceFiles()) {
      const rel = path.relative(REPO, sourceFile.getFilePath())
      if (!rel.startsWith('src/')) continue
      for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (assignment.getName() !== 'bypassFilters') continue
        const initializer = assignment.getInitializer()?.getText()
        // `true` is a producer; anything else is a computed write the scan misses.
        if (initializer !== 'true') suspicious.push(`${rel}: bypassFilters: ${initializer ?? '?'}`)
      }
    }
    expect(
      suspicious,
      `computed writes the census cannot see:\n  ${suspicious.join('\n  ')}`,
    ).toEqual([])
  })

  it("every classification's cited test file exists", () => {
    // The `verified` strings name test files — `behavioural:
    // cross-layer-finding-owns-its-remedy.test.ts — fixing the .layer() glob
    // clears it`. Nothing asserted those files existed, so a rename left the row
    // green pointing at nothing: a hand-maintained pointer inside a census built
    // to replace hand-maintained pointers, which is this file's own subject.
    //
    // All ten resolved when review checked them by hand. Checking them by hand is
    // the problem — that is a measurement with a shelf life, and this row gives it
    // one that does not expire.
    const testFiles = new Set<string>()
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.test.ts')) testFiles.add(entry.name)
      }
    }
    walk(path.join(REPO, 'tests'))

    // Vacuity: the walk found tests, and the citations were actually extracted.
    expect(testFiles.size).toBeGreaterThan(100)

    const cited: { key: string; file: string }[] = []
    for (const [key, entry] of Object.entries(CLASSIFIED)) {
      for (const match of entry.verified.matchAll(/([\w.-]+\.test\.ts)/g)) {
        const name = match[1]
        if (name !== undefined) cited.push({ key, file: name })
      }
    }
    expect(cited.length).toBeGreaterThan(5)

    const missing = cited
      .filter((c) => !testFiles.has(c.file))
      .map((c) => `${c.key} cites ${c.file}, which does not exist`)
    expect(missing, `dead test citations:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('no two producers share a census key', () => {
    // The key is `path::enclosingFunction`, and `live` is a Set — so two
    // producers in one function collapse to one entry, and the second is
    // invisible to every other row in this file. Classifying the first would
    // silently classify the second, which is the exact false green the census
    // exists to remove: a producer nobody has looked at, counted as looked at.
    //
    // No collision exists today, measured. This row is what makes that a fact
    // rather than an assumption — when a function grows a second finding, this
    // fails and the key has to be refined (a per-function ordinal is the obvious
    // next step) instead of the new producer disappearing.
    const seen = new Map<string, number[]>()
    for (const producer of producers(loadSource())) {
      seen.set(producer.key, [...(seen.get(producer.key) ?? []), producer.line])
    }
    const collisions = [...seen.entries()]
      .filter(([, lines]) => lines.length > 1)
      .map(([key, lines]) => `${key} at lines ${lines.join(', ')}`)
    expect(collisions, `census keys are not unique:\n  ${collisions.join('\n  ')}`).toEqual([])
  })

  it("every producer sets its OWN suggestion, never the rule author's", () => {
    // ADR-008 rule 2 and bug 0021, across every producer at once. The guard this
    // replaces asserted `toBeTruthy()` on three of fifteen — presence, not
    // correctness — so it could not have caught bug 0042, which printed the rule
    // author's fix for a real violation on a finding about a mis-globbed layer.
    //
    // ## Resolved by SYMBOL, not by spelling
    //
    // The first version matched a hand-written list of strings —
    // `context.suggestion`, `meta?.suggestion`, and so on. Measured, three
    // producers defeated it while passing every row of this file:
    //
    //   const { suggestion } = context        // destructured
    //   suggestion: c.suggestion              // parameter aliased to `c`
    //   suggestion: authorRemedy(context)     // read through a helper
    //
    // A hand-maintained list of spellings, inside a census built to replace
    // hand-maintained lists. So the check asks ts-morph what each identifier
    // **resolves to** and flags anything deriving from a parameter that carries
    // the author's metadata — a different kind of evidence than text, which is
    // what rule 5 asks for.
    const AUTHOR_TYPES = [
      'ConditionContext',
      'PairConditionContext',
      'RuleMetadata',
      // `ViolationMeta` is a carrier: `correspondence-builder`'s `baseViolation`
      // reads `meta.suggestion` straight out of it, which is correct for a real
      // violation and is precisely bug 0021 on a configuration finding.
      'ViolationMeta',
    ]

    /** Parameters of `fn` whose type is one the author's metadata travels in. */
    const authorParams = (fn: Node): Set<string> => {
      const names = new Set<string>()
      if (!Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn)) return names
      for (const param of fn.getParameters()) {
        const typeText = param.getTypeNode()?.getText() ?? param.getType().getText()
        if (AUTHOR_TYPES.some((t) => typeText.includes(t))) names.add(param.getName())
      }
      return names
    }

    /**
     * Does this expression derive from one of `params`?
     *
     * One hop through a local `const`, which is what covers destructuring: the
     * initializer is a bare identifier whose declaration is
     * `const { suggestion } = context`. And one hop into a called function, for a
     * remedy read through a helper.
     */
    const derivesFrom = (expr: Node, params: Set<string>, depth = 0): boolean => {
      // **Residue, stated rather than deferred.** Two hops, so a remedy laundered
      // through three (`context` -> local -> helper -> helper) escapes. Bounded on
      // purpose: ADR-008 rule 6 puts this row at "an internal check over a corpus
      // we control", where the standard is to prove each detector fires and stop.
      // Four shapes are proven to fire below — a direct read, an aliased
      // parameter, a destructured local, and a helper — which covers every
      // spelling present in `src/`. Raise the bound when a real producer needs it,
      // not in advance.
      if (depth > 2) return false
      const nodes = [expr, ...expr.getDescendants()]

      // `suggestion,` is a ShorthandPropertyAssignment, and `getSymbol()` on its
      // identifier resolves to the PROPERTY, not to the local — so the walk below
      // sees a symbol declared by the object literal itself and learns nothing.
      // Measured: this was the one escape of three that survived the first
      // symbol-resolution pass, `const { suggestion } = context`. `getValueSymbol()`
      // is ts-morph's accessor for the checker's shorthand value symbol.
      for (const node of nodes) {
        if (!Node.isShorthandPropertyAssignment(node)) continue
        for (const decl of node.getValueSymbol()?.getDeclarations() ?? []) {
          if (declLeadsToAuthor(decl, params, depth)) return true
        }
      }

      const ids = nodes.filter((n) => Node.isIdentifier(n))
      for (const id of ids) {
        if (params.has(id.getText())) return true
        for (const decl of id.getSymbol()?.getDeclarations() ?? []) {
          if (declLeadsToAuthor(decl, params, depth)) return true
        }
      }
      return false
    }

    /** One hop out of a declaration, shared by the shorthand and identifier paths. */
    const declLeadsToAuthor = (decl: Node, params: Set<string>, depth: number): boolean => {
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer()
        if (init && derivesFrom(init, params, depth + 1)) return true
      }
      if (Node.isBindingElement(decl)) {
        const varDecl = decl.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
        const init = varDecl?.getInitializer()
        if (init && derivesFrom(init, params, depth + 1)) return true
      }
      if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) {
        const inner = authorParams(decl)
        for (const ret of decl.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
          const value = ret.getExpression()
          if (value && derivesFrom(value, inner, depth + 1)) return true
        }
      }
      return false
    }

    const project = loadSource()
    const problems: string[] = []
    for (const sourceFile of project.getSourceFiles()) {
      const rel = path.relative(REPO, sourceFile.getFilePath())
      if (!rel.startsWith('src/')) continue
      for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (assignment.getName() !== 'bypassFilters') continue
        if (assignment.getInitializer()?.getText() !== 'true') continue
        const literal = assignment.getParent()
        if (!Node.isObjectLiteralExpression(literal)) {
          problems.push(`${rel}: bypassFilters is not in an object literal`)
          continue
        }
        const key = `${rel}::${enclosingName(assignment)}`

        const enclosing = assignment.getFirstAncestor(
          (n) => Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n),
        )
        const params = enclosing ? authorParams(enclosing) : new Set<string>()

        // A spread can carry the author's `suggestion` in invisibly — but a later
        // property wins, and `correspondence-builder.ts::emptyViolation` relies on
        // exactly that: it spreads a helper shared with real violations (where
        // inheriting the author's remedy IS correct) and then overrides. So the
        // finding is not "there is a spread", it is "a spread carries the author's
        // remedy and nothing after it overrides".
        for (const spread of literal.getProperties()) {
          if (!Node.isSpreadAssignment(spread)) continue
          // `derivesFrom` already follows a call into the callee's own author
          // params, so the enclosing `params` need not mention `meta`.
          if (!derivesFrom(spread.getExpression(), params)) continue
          for (const field of ['suggestion', 'docs'] as const) {
            const override = literal.getProperty(field)
            if (override === undefined || override.getPos() < spread.getPos()) {
              problems.push(
                `${key}: spreads \`${spread.getExpression().getText()}\`, which carries the ` +
                  `author's metadata, and does not override ${field} after it`,
              )
            }
          }
        }

        for (const field of ['suggestion', 'docs'] as const) {
          const property = literal.getProperty(field)
          if (field === 'suggestion' && property === undefined) {
            problems.push(`${key}: no suggestion — a configuration finding with no remedy`)
            continue
          }
          if (property === undefined) continue
          const expr = Node.isPropertyAssignment(property)
            ? (property.getInitializer() ?? property)
            : property
          if (params.size > 0 && derivesFrom(expr, params)) {
            problems.push(`${key}: ${field} derives from the author's metadata`)
          }
        }
      }
    }
    expect(problems, `remedy problems:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('every producer says whether its remedy has been PROVEN to remediate', () => {
    // The half no static check can do. `verified` is a decision, and the census
    // forces one per producer — a new producer cannot arrive without someone
    // saying whether the remedy was tried or only written.
    //
    // `stated-only` is not a free pass. Bug 0017's remedy and BOTH of bug 0042's
    // wrong remedies passed every contains-check ever written about them; only
    // applying the fix found them. Each `stated-only` entry carries why applying
    // it is not possible, so the reason is arguable rather than assumed.
    const live = producers(loadSource()).map((p) => p.key)
    for (const key of live) {
      const entry = CLASSIFIED[key]
      expect(entry, `${key} is unclassified`).toBeDefined()
      expect(entry?.verified, `${key} has no verification status`).toBeTruthy()
      expect(
        entry?.verified.startsWith('behavioural:') || entry?.verified.startsWith('stated-only:'),
        `${key}: verified must begin "behavioural:" or "stated-only:" — got "${entry?.verified ?? ''}"`,
      ).toBe(true)
    }

    // Vacuity, and a ratchet: most remedies are proven, and the count must not
    // quietly slide the other way as producers are added.
    const behavioural = live.filter((k) => CLASSIFIED[k]?.verified.startsWith('behavioural:'))
    expect(behavioural.length).toBeGreaterThanOrEqual(11)
  })

  it('a helper-supplied remedy is followed to its call sites', () => {
    // `assertDiscovered` is one census row, but its `suggestion` is
    // `finding.remedy` — supplied by each caller. The strings a reader actually
    // gets are written there, so the census would see one row and never look at
    // them. A third caller elsewhere would add a reader-facing remedy this file
    // reports nothing about.
    //
    // ## This row could not fail for two releases
    //
    // It asserted `expect(site.remedy).toContain('remedy')` where `site.remedy`
    // was the **source text of the whole second argument** — and `remedy` is a
    // mandatory property of `assertDiscovered`'s parameter type, so the property
    // *key* satisfied it. Measured by review: a third call site with
    // `remedy: ''` — a configuration finding shipping no remedy at all — passed
    // `tsc` and the full suite unchanged.
    //
    // A false green inside the guard built to stop false greens, and the row's
    // own docstring names the case it could not see. It is also precisely
    // ADR-008 rule 5's question asked and answered wrong: "what would this do if
    // the thing it guards were completely broken?" — pass, because the assertion
    // read the shape of the call instead of the value of the remedy.
    //
    // Now: resolve the `remedy` property and judge its VALUE.
    const project = loadSource()

    /** The literal text of an expression, following one hop through a local const. */
    const literalText = (expr: Node, depth = 0): string | undefined => {
      if (depth > 1) return undefined
      if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
        return expr.getLiteralText()
      }
      // A template with substitutions is a remedy built per-call; its static
      // parts are what a reader is guaranteed to see.
      if (Node.isTemplateExpression(expr)) return expr.getText()
      if (Node.isBinaryExpression(expr)) {
        const left = literalText(expr.getLeft(), depth)
        const right = literalText(expr.getRight(), depth)
        return `${left ?? ''}${right ?? ''}`
      }
      if (Node.isIdentifier(expr)) {
        for (const decl of expr.getSymbol()?.getDeclarations() ?? []) {
          if (Node.isVariableDeclaration(decl)) {
            const init = decl.getInitializer()
            if (init) return literalText(init, depth + 1)
          }
        }
      }
      return undefined
    }

    const problems: string[] = []
    let sites = 0
    for (const sourceFile of project.getSourceFiles()) {
      const rel = path.relative(REPO, sourceFile.getFilePath())
      if (!rel.startsWith('src/')) continue
      for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const name = callExpr.getExpression().getText()
        if (!REMEDY_HELPERS.some((helper) => name === helper)) continue
        sites += 1
        const where = `${rel}:${String(callExpr.getStartLineNumber())}`
        const arg = callExpr.getArguments()[1]
        if (arg === undefined || !Node.isObjectLiteralExpression(arg)) {
          // Not a defect by itself — but the remedy a reader gets is then
          // invisible to this census, which is the whole point of the row. Fail
          // so someone decides, rather than passing on something unexamined.
          problems.push(
            `${where}: second argument is not an inline object, so its remedy is unread`,
          )
          continue
        }
        const property = arg.getProperty('remedy')
        if (property === undefined) {
          problems.push(`${where}: no remedy property`)
          continue
        }
        const expr = Node.isPropertyAssignment(property)
          ? (property.getInitializer() ?? property)
          : property
        const text = literalText(expr)
        if (text === undefined) {
          problems.push(`${where}: remedy \`${expr.getText()}\` does not resolve to a literal`)
          continue
        }
        // A remedy has to tell the reader what to DO. The floor is deliberately
        // low — this row's job is to catch absence, and rule 2's corollary (a
        // remedy is a claim, so apply it) is the behavioural tests' job.
        if (text.trim().length < 20) {
          problems.push(`${where}: remedy is ${String(text.trim().length)} chars: "${text.trim()}"`)
        }
      }
    }

    // Vacuity: the helper really is called, or the loop above asserts nothing.
    expect(sites).toBeGreaterThanOrEqual(2)
    expect(problems, `helper call-site remedies:\n  ${problems.join('\n  ')}`).toEqual([])
  })
})
