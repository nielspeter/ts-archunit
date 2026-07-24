import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { functions } from '../../src/builders/function-rule-builder.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

function inMemoryProject(files: Record<string, string>): ArchProject {
  const project = new Project({ useInMemoryFileSystem: true })
  for (const [name, code] of Object.entries(files)) project.createSourceFile(name, code)
  return {
    tsConfigPath: 'in-memory',
    _project: project,
    getSourceFiles: () => project.getSourceFiles(),
  }
}

const FIXTURE = {
  'src/routes.ts': `export const app = {
  routes: {
    "/owners/:id": { GET: async () => {}, POST(req: unknown) { return req } },
  },
}
export function named() {}
`,
}

const tuple = (fn: ArchFunction): string =>
  `${fn.getName() ?? '<anon>'}@${fn.getSourceFile().getBaseName()}:${String(fn.getStartLineNumber())}`

describe('functions({ includeObjectLiteralFunctions }) (proposal 016)', () => {
  it('default (OFF) does not collect object-literal functions', () => {
    const p = inMemoryProject(FIXTURE)
    const names = functions(p).subjects().map((f) => f.getName())
    expect(names).toEqual(['named'])
  })

  it('ON collects arrow + method-shorthand handlers, named by qualified key path', () => {
    const p = inMemoryProject(FIXTURE)
    const names = functions(p, { includeObjectLiteralFunctions: true })
      .subjects()
      .map((f) => f.getName())
    expect(names).toContain('routes["/owners/:id"].GET')
    expect(names).toContain('routes["/owners/:id"].POST')
  })

  it('ADR-008 acceptance: ON = OFF ∪ exactly the handler set, by identity (name+file:line)', () => {
    const p = inMemoryProject(FIXTURE)
    const off = new Set(functions(p).subjects().map(tuple))
    const on = new Set(functions(p, { includeObjectLiteralFunctions: true }).subjects().map(tuple))

    // Vacuity guard: the fixture genuinely contributes object-literal functions.
    expect(on.size).toBeGreaterThan(off.size)

    // OFF ⊆ ON (nothing dropped)
    expect([...off].every((t) => on.has(t))).toBe(true)

    // ON adds exactly the two handlers — identity, not cardinality.
    const added = [...on].filter((t) => !off.has(t))
    expect(added).toHaveLength(2)
    expect(added.some((t) => t.startsWith('routes["/owners/:id"].GET@'))).toBe(true)
    expect(added.some((t) => t.startsWith('routes["/owners/:id"].POST@'))).toBe(true)
  })

  it('the flag survives a .should() fork (named selection)', () => {
    const p = inMemoryProject(FIXTURE)
    const seen: string[] = []
    functions(p, { includeObjectLiteralFunctions: true })
      .that()
      .haveNameMatching(/\.GET$/)
      .should()
      .satisfy({
        description: 'record subjects',
        evaluate: (elements: ArchFunction[]) => {
          for (const el of elements) seen.push(el.getName() ?? '')
          return []
        },
      })
      .check()
    // If the fork had dropped the option, getElements() would not collect the
    // handler and `seen` would be empty.
    expect(seen).toContain('routes["/owners/:id"].GET')
  })
})
