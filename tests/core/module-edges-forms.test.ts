/**
 * Every edge-carrying form, classified — plan 0071 test-inventory items 4, 5, 6,
 * 8 and 16.
 *
 * Asserted as **one explicit expected list with the deliberate absences in it**,
 * not as a set of spot checks. A spot-checking suite cannot distinguish "this
 * form is correctly not an edge" from "we forgot this form exists", and five of
 * the 20 rows in §1's table are absences.
 *
 * The fixture's line numbers are part of the assertion, which is why it carries a
 * **multi-line form of every kind**: statement and literal lines differ for
 * `import` (28 vs 30), `reexport` (31 vs 33), `dynamic` (34 vs 35) and
 * `type-expression` (37 vs 38), so `line = literal.getStartLineNumber()` passes
 * every single-line test in this file and fails four of these.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Node, Project } from 'ts-morph'
import { edgesOf, moduleEdges } from '../../src/core/module-edges.js'
import type { ModuleEdge } from '../../src/core/module-edges.js'

const fixtureRoot = path.join(import.meta.dirname, '../fixtures/module-edge-forms')
const project = new Project({ tsConfigFilePath: path.join(fixtureRoot, 'tsconfig.json') })

/** One edge, flattened to what the assertions care about. */
interface Row {
  line: number
  kind: string
  typeOnly: boolean
  names: string
  specifier: string
  resolved: string
}

const rows = (edges: readonly ModuleEdge[]): Row[] =>
  edges.map((e) => ({
    line: e.line,
    kind: e.kind,
    typeOnly: e.typeOnly,
    names: e.names.join(','),
    // `specifier` is included so the field has a guard at all: every consumer path
    // goes through `resolvedPath`, and `candidatesFor` returns `[resolvedPath]`
    // alone for a relative specifier, so nothing else compares it.
    specifier: e.specifier,
    resolved: e.resolvedPath === undefined ? 'UNRESOLVED' : path.basename(e.resolvedPath),
  }))

const file = (name: string): readonly ModuleEdge[] => edgesOf(project.getSourceFileOrThrow(name))

describe('every edge-carrying form (items 4, 5, 6, 8)', () => {
  it('classifies all 24 edges in forms.ts, by line, kind, typeOnly and names', () => {
    expect(rows(file('forms.ts'))).toEqual([
      // --- static imports -----------------------------------------------------
      {
        line: 5,
        kind: 'import',
        typeOnly: false,
        names: 'RUNTIME',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 6,
        kind: 'import',
        typeOnly: true,
        names: 'Erased',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 7,
        kind: 'import',
        typeOnly: true,
        names: 'Second',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // side-effect import: runtime, no names
      {
        line: 8,
        kind: 'import',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // `import {} from`: runtime, zero specifiers — NOT type-only, because
      // `every()` over an empty list is true and the length guard is what stops it
      {
        line: 9,
        kind: 'import',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // namespace and default bindings contribute NO names, by design
      {
        line: 10,
        kind: 'import',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 11,
        kind: 'import',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // `import MIXED, { type Erased as E2 }` is a RUNTIME edge. This is the row
      // §2 calls load-bearing: a formula without `isTypeOnlyImport`'s
      // getDefaultImport()/getNamespaceImport() guards calls it type-only and
      // skips it under `ignoreTypeImports` — a lost existing finding.
      {
        line: 12,
        kind: 'import',
        typeOnly: false,
        names: 'Erased',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // an aliased import reports the INWARD name, `RUNTIME`, not `ALIASED`
      {
        line: 13,
        kind: 'import',
        typeOnly: false,
        names: 'RUNTIME',
        specifier: './target.js',
        resolved: 'target.ts',
      },

      // --- re-exports ---------------------------------------------------------
      {
        line: 14,
        kind: 'reexport',
        typeOnly: false,
        names: 'OTHER',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // an aliased re-export reports the OUTWARD name, `OUTWARD`, not `OTHER`:
      // that is the key the re-exporting module's runtime namespace carries, and
      // item 7 compares against a runtime namespace
      {
        line: 15,
        kind: 'reexport',
        typeOnly: false,
        names: 'OUTWARD',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // bare `export *`: no names, deliberately — see ModuleEdge.names
      {
        line: 16,
        kind: 'reexport',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // `export * as NS` is NOT a star for this purpose: one statically-known
      // name, no recursion. `isNamespaceExport()` is true for BOTH forms, so
      // `getNamespaceExport()` is the only thing that tells them apart.
      {
        line: 17,
        kind: 'reexport',
        typeOnly: false,
        names: 'STAR_NS',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 18,
        kind: 'reexport',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // both §2 trap rows: decl-level type-only, then specifier-level type-only
      {
        line: 19,
        kind: 'reexport',
        typeOnly: true,
        names: 'ErasedOut',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 20,
        kind: 'reexport',
        typeOnly: true,
        names: 'SecondOut',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // `export type *`: type-only star
      {
        line: 21,
        kind: 'reexport',
        typeOnly: true,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },

      // --- dynamic ------------------------------------------------------------
      {
        line: 22,
        kind: 'dynamic',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      // The NoSubstitutionTemplateLiteral row. `Node.isStringLiteral()` is FALSE
      // for this literal while `getImportStringLiterals()` is declared
      // `StringLiteral[]`, so a defensive narrow drops the edge and tsc says
      // nothing. On its own line, because two dynamic edges on one line are
      // indistinguishable in every field.
      {
        line: 23,
        kind: 'dynamic',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },

      // --- type expression ----------------------------------------------------
      // Resolves to the NAMED module. Following the type symbol instead lands on
      // whatever declares `Erased`, which would make notImportFrom fire on a file
      // the source never names.
      {
        line: 24,
        kind: 'type-expression',
        typeOnly: true,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },

      // --- the multi-line forms: STATEMENT lines, not literal lines ------------
      {
        line: 28,
        kind: 'import',
        typeOnly: false,
        names: 'OTHER',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 31,
        kind: 'reexport',
        typeOnly: false,
        names: 'MULTILINE_REEXPORT',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 34,
        kind: 'dynamic',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 37,
        kind: 'type-expression',
        typeOnly: true,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
    ])
  })

  it('reports the statement line, which differs from the literal line for every kind', () => {
    // The same property stated as the difference itself, so a regression names
    // the cause rather than dumping a 24-row diff. Each pair is (statement,
    // literal) in the fixture.
    const byLine = new Map(file('forms.ts').map((e) => [e.line, e.kind]))
    expect([...byLine.keys()]).toContain(28) // import: literal is on 30
    expect([...byLine.keys()]).toContain(31) // reexport: literal is on 33
    expect([...byLine.keys()]).toContain(34) // dynamic: literal is on 35
    expect([...byLine.keys()]).toContain(37) // type-expression: literal is on 38
    for (const literalLine of [30, 33, 35, 38]) {
      expect(byLine.has(literalLine)).toBe(false)
    }
  })

  it('does not see the five forms that are not edges', () => {
    const forms = file('forms.ts')
    // Non-vacuity first: if the walk returned nothing, every absence below would
    // hold trivially.
    expect(forms.length).toBe(24)

    // A computed specifier — `import('./tar' + 'get.js')` on line 25 — is not an
    // edge for ANY family, and must not be inferred.
    expect(forms.map((e) => e.line)).not.toContain(25)
    // `export { RUNTIME as NoSpecifier }` on line 26 has no module specifier.
    expect(forms.map((e) => e.line)).not.toContain(26)
    // `require()` in .ts yields zero literals: the binder does not collect it.
    expect(file('plain-require.ts')).toEqual([])
    // An empty ambient body is correctly not an edge; a NON-empty one is a stated
    // hole, and both live in ambient.d.ts, which must produce nothing either way.
    expect(file('ambient.d.ts')).toEqual([])
    // `declare module './target.js' { … }` is a real compile-time reference the
    // binder routes to `moduleAugmentations`, so the walk structurally cannot see
    // it. A hole, stated in the plan's Out of scope — asserted here so it is a
    // known absence rather than a surprise.
    expect(file('augment.ts')).toEqual([])
  })
})

describe('the two classification traps (item 16)', () => {
  /**
   * Both would mark a **runtime** dependency as erased, which under
   * `{ ignoreTypeImports: true }` means silently skipped.
   */
  it('classifies `import x = require()` as require and RUNTIME, not type-expression', () => {
    expect(rows(file('equals.d.ts'))).toEqual([
      {
        line: 3,
        kind: 'require',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
    ])
  })

  it('classifies `require()` in .js as require and RUNTIME, both literal kinds', () => {
    // Parent is `CallExpression` — the same parent kind as `import()`. Only
    // `getExpression().getKind() === ImportKeyword` tells them apart, and getting
    // that wrong makes every CJS require look like a dynamic import.
    expect(rows(file('cjs.js'))).toEqual([
      {
        line: 4,
        kind: 'require',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
      {
        line: 5,
        kind: 'require',
        typeOnly: false,
        names: '',
        specifier: './target.js',
        resolved: 'target.ts',
      },
    ])
  })
})

describe('resolution goes through the specifier symbol (item 6)', () => {
  it('resolves every kind to the named module', () => {
    // One mechanism, five parent kinds, one answer. Asserted as "every edge in
    // the file resolved" rather than per-kind, because a per-kind assertion would
    // pass with four kinds silently unresolved.
    const unresolved = file('forms.ts').filter((e) => e.resolvedPath === undefined)
    expect(unresolved).toEqual([])
  })

  /**
   * The augmentation case (plan 0071 §1). `augment.ts` augments
   * `'./target.js'`, so the specifier's symbol in `forms.ts` has **two**
   * declarations — the `SourceFile` and a `ModuleDeclaration` — and resolution
   * must pick the SourceFile.
   *
   * **Stated limit, and it is a real hole in this guard.** A
   * `getDeclarations()[0]` implementation passes this test. That is not specific
   * to this fixture: measured across four shapes — the augmenting file sorting
   * first alphabetically, two augmentations of one module, a `.d.ts` target, and
   * the augmentation written inside the importing file — the `SourceFile` came
   * first every time. The `find` is defence against an ordering that ts-morph's
   * own `ModuleUtils.getReferencedSourceFileFromSymbol` treats as live (it takes
   * `[0]` and bails to `undefined` when the first declaration is not a
   * SourceFile), and no arrangement available here reproduces it, because merge
   * order is the compiler's to choose. A review called this a certain field false
   * positive; it is not, on any ordering that could be constructed.
   */
  it('resolves to the augmented module, never to the augmenting file', () => {
    const literal = project.getSourceFileOrThrow('forms.ts').getImportStringLiterals()[0]
    expect(literal).toBeDefined()
    // The premise: without two declarations this test asserts nothing.
    expect(literal?.getSymbol()?.getDeclarations().length).toBe(2)

    for (const edge of file('forms.ts')) {
      expect(edge.resolvedPath).not.toContain('augment.ts')
      expect(edge.resolvedPath).toContain('target.ts')
    }
  })
})

describe('moduleEdges over many files', () => {
  it('keys by absolute path and covers every file, including the edgeless ones', () => {
    const files = project.getSourceFiles()
    const map = moduleEdges(files)

    expect(map.size).toBe(files.length)
    // An edgeless file must be present with an empty list, not absent: a consumer
    // doing `map.get(path) ?? []` cannot tell "no edges" from "not walked", and
    // the second is the false green.
    for (const sf of files) {
      expect(map.has(sf.getFilePath())).toBe(true)
    }
    expect(map.get(project.getSourceFileOrThrow('target.ts').getFilePath())).toEqual([])
    expect(map.get(project.getSourceFileOrThrow('forms.ts').getFilePath())).toHaveLength(24)
  })
})

describe('the fixture still carries the property it is asserted for', () => {
  /**
   * The multi-line forms are the ONLY thing distinguishing a statement/carrier line
   * from a literal line, and they are one `prettier --write` away from being gone.
   *
   * `.prettierignore` holds that today — measured, and it works. But if the fixture
   * were ever collapsed, the 24-row expected list above becomes byte-identical under
   * both `line` derivations, and the cheapest way to make a 24-row line diff green is
   * to regenerate the list — after which `line = literal.getStartLineNumber()` passes
   * everything.
   *
   * So this derives the property from the fixture instead of restating line numbers:
   * a regenerated expected list cannot satisfy it.
   */
  it('has a form of every kind whose carrier line differs from its literal line', () => {
    const sourceFile = project.getSourceFileOrThrow('forms.ts')
    const moved = new Set<string>()
    for (const literal of sourceFile.getImportStringLiterals()) {
      const carrier = literal.getFirstAncestor(
        (a) =>
          Node.isImportDeclaration(a) ||
          Node.isExportDeclaration(a) ||
          Node.isImportEqualsDeclaration(a) ||
          Node.isCallExpression(a) ||
          Node.isImportTypeNode(a),
      )
      if (carrier !== undefined && carrier.getStartLineNumber() !== literal.getStartLineNumber()) {
        moved.add(carrier.getKindName())
      }
    }
    // One per kind. `getKindName()` says `ImportType` where the ts-morph guard is
    // `isImportTypeNode` — asserted as the kind name, not the guard name. If a
    // formatter collapses the fixture this list shrinks and names the cause.
    expect([...moved].sort()).toEqual([
      'CallExpression',
      'ExportDeclaration',
      'ImportDeclaration',
      'ImportType',
    ])
  })
})
