import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { comment, STUB_PATTERNS } from '../../src/helpers/matchers.js'
import { noStubComments } from '../../src/rules/hygiene.js'
import { collectFunctions } from '../../src/models/arch-function.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/stubs')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('comment() matcher', () => {
  const p = loadTestProject()

  it('catches // TODO comment', () => {
    expect(() => {
      modules(p).that().resideInFile('**/has-todo.ts').should().notContain(comment(/TODO/)).check()
    }).toThrow(ArchRuleError)
  })

  it('catches /* FIXME */ block comment', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-fixme-block.ts')
        .should()
        .notContain(comment(/FIXME/))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches HACK comment inside function', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/has-hack.ts')
        .should()
        .notContain(comment(/HACK/))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('does NOT match TODO/FIXME inside string literals', () => {
    // todo-in-string.ts has 'TODO: fix this later' and 'FIXME: known issue' as strings, not comments
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/todo-in-string.ts')
        .should()
        .notContain(comment(/TODO|FIXME/))
        .check()
    }).not.toThrow()
  })

  it('no false positives on clean module', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/clean.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).not.toThrow()
  })
})

describe('STUB_PATTERNS', () => {
  const p = loadTestProject()

  it('catches TODO', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-todo.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches FIXME', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-fixme-block.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches HACK', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/has-hack.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches STUB and "coming soon"', () => {
    // has-stub-marker.ts has "STUB" and "coming soon" in comments
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-stub-marker.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('custom pattern overrides defaults', () => {
    // Only look for DEFERRED — none of the fixtures have it
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-todo.ts')
        .should()
        .notContain(comment(/DEFERRED/))
        .check()
    }).not.toThrow()
  })
})

describe('notHaveEmptyBody — functions', () => {
  const p = loadTestProject()

  it('catches empty function body', () => {
    expect(() => {
      functions(p).that().resideInFile('**/empty-function.ts').should().notHaveEmptyBody().check()
    }).toThrow(ArchRuleError)
  })

  it('passes function with body', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^hasBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })

  it('expression-bodied arrow always passes', () => {
    // arrowWithBody = () => 42 — expression body, not a block
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^arrowWithBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })

  it('catches function with only a comment (still empty)', () => {
    // commentOnlyBody has { // TODO: implement this } — zero statements
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^commentOnlyBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('notHaveEmptyBody — classes', () => {
  const p = loadTestProject()

  it('catches empty class', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^EmptyClass$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes class with members', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^NonEmptyClass$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })
})

describe('WHERE a stub marker may be, and what is merely prose (bugs 0052, 0053)', () => {
  // These two bugs shipped together and this block guards both, because they are
  // one behaviour from a caller's side: "does `noStubComments()` report this?"
  //
  // Both were CAUGHT BY NOTHING when first fixed. The fix was measured with
  // throwaway probes, the numbers went into the bug write-ups, and nothing
  // permanent held them — so reverting either half left the suite green. That is
  // ADR-008 rule 5 exactly, and bug 0052's own write-up had already asked "what
  // would the suite do if the fix were wrong?" before the answer became "nothing".
  const found = (code: string): number => {
    const p = new Project({ useInMemoryFileSystem: true })
    const sf = p.createSourceFile('t.ts', code)
    return noStubComments().evaluate(collectFunctions(sf), { rule: 'r' }).length
  }

  it.each([
    // --- bug 0052: placements a real marker occupies ---
    ['inside the body', 'export function a(): number {\n  // TODO: x\n  return 1\n}', 1],
    ['trailing the function', 'export function b(): number {\n  return 1\n} // TODO: x', 1],
    ['a leading line comment', '// TODO: x\nexport function c(): number {\n  return 1\n}', 1],
    ['a leading JSDoc', '/** TODO: x */\nexport function d(): number {\n  return 1\n}', 1],
    // The two rows that separate the full fix from the half fix: for an arrow
    // assigned to a const, the docstring attaches to the VariableStatement, two
    // levels above the node `getNode()` returns.
    ['a leading JSDoc on an arrow const', '/** TODO: x */\nexport const e = (): number => 1', 1],
    ['a leading line comment on an arrow const', '// TODO: x\nexport const f = (): number => 1', 1],
    [
      'a JSDoc line inside a block',
      '/**\n * TODO: x\n */\nexport function g(): number {\n  return 1\n}',
      1,
    ],

    // --- bug 0053: prose that mentions a marker is not a marker ---
    // An UPPERCASE marker mid-sentence. This row is what tests the line-start
    // anchor, and the first version of it did not: it embedded `/** TODO */` inside
    // a JSDoc, so the inner `*/` closed the comment early and the fixture was
    // malformed — it passed because nothing parsed, not because the anchor worked.
    // Found by sabotage: dropping the anchor was caught by nothing.
    [
      'PROSE: an uppercase marker mid-sentence',
      '/** Never write a TODO marker in prose like this. */\nexport function h(): number {\n  return 1\n}',
      0,
    ],
    [
      'PROSE: an uppercase marker mid-line in a JSDoc block',
      '/**\n * Some text and then TODO appears mid-line.\n */\nexport function h2(): number {\n  return 1\n}',
      0,
    ],
    [
      'PROSE: the English word deferred',
      '/** Resolution requires lookups and is deferred. */\nexport function i(): number {\n  return 1\n}',
      0,
    ],
    [
      'PROSE: a wrapped lowercase "stub," at a line start',
      '/**\n * A\n * stub, which the compiler could not have done anyway.\n */\nexport function j(): number {\n  return 1\n}',
      0,
    ],
    [
      'PROSE: documentation listing the phrases the rule matches',
      '/**\n * Catches markers and phrases like\n * "not implemented" or "coming soon".\n */\nexport function k(): number {\n  return 1\n}',
      0,
    ],

    // --- controls ---
    [
      'CONTROL a clean function',
      '/** All good. */\nexport function l(): number {\n  return 1\n}',
      0,
    ],
    ['CONTROL a clean arrow const', '/** All good. */\nexport const m = (): number => 1', 0],
    // Two DISTINCT comments are two findings — the dedup must be per comment, not
    // per function, and must not collapse or duplicate.
    [
      'CONTROL two distinct markers on one function',
      '// TODO: x\nexport function n(): number {\n  // TODO: y\n  return 1\n}',
      2,
    ],
    // The over-reach a naive `triviaRoot` produces: an inner arrow inheriting the
    // outer function's docstring would make this 2.
    [
      'CONTROL a nested arrow does not inherit the outer docstring',
      '/** TODO: x */\nexport function o(): unknown {\n  const inner = (): number => 1\n  return inner\n}',
      1,
    ],
  ])('%s', (_label, code, expected) => {
    expect(found(code)).toBe(expected)
  })

  it('a real marker is still reported when the phrase forms are lowercase', () => {
    // The phrase arm stays case-insensitive on purpose — nobody writes
    // "NOT IMPLEMENTED" — while the MARKERS are case-sensitive. Both halves of that
    // asymmetry asserted, or a later simplification collapses them.
    expect(found('// not implemented yet\nexport function p(): number {\n  return 1\n}')).toBe(1)
    // ...and a lowercase marker is NOT reported, which is the stated price of not
    // matching "the todo list below". Pinned so it is a decision, not a surprise.
    expect(found('// todo x\nexport function q(): number {\n  return 1\n}')).toBe(0)
  })
})
