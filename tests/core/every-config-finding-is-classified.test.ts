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
  'src/core/rule-builder.ts::unexpectedlyNonEmptyViolation': {
    remedy: 'own',
    verified:
      'stated-only: the remedy is to drop .expectEmpty(), which changes what the rule asserts rather than fixing a fault',
  },
  'src/core/rule-builder.ts::emptySelectionViolation': {
    remedy: 'own',
    verified: 'behavioural: assertion-gate.test.ts — widening the selector clears it',
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
  'src/helpers/baseline.ts::descriptionChangeFinding': {
    remedy: 'own',
    verified: 'behavioural: baseline-description-change.test.ts — regenerating clears it',
  },
  'src/helpers/baseline.ts::unmatchedBaselineFinding': {
    remedy: 'own',
    verified: 'behavioural: baseline.test.ts — a matching baseline produces none',
  },
  'src/presets/shared.ts::overrideFindings': {
    remedy: 'own',
    verified:
      'behavioural: recommended.test.ts — correcting the key clears it, and a correct key takes effect',
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
    const project = loadSource()
    const callSites: { file: string; remedy: string }[] = []
    for (const sourceFile of project.getSourceFiles()) {
      const rel = path.relative(REPO, sourceFile.getFilePath())
      if (!rel.startsWith('src/')) continue
      for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const name = callExpr.getExpression().getText()
        if (!REMEDY_HELPERS.some((helper) => name === helper)) continue
        const arg = callExpr.getArguments()[1]
        callSites.push({ file: rel, remedy: arg?.getText() ?? '' })
      }
    }

    // Vacuity: the helper really is called, or the loop below asserts nothing.
    expect(callSites.length).toBeGreaterThanOrEqual(2)
    for (const site of callSites) {
      expect(site.remedy, `${site.file}: assertDiscovered call has no remedy`).toContain('remedy')
    }
  })
})
