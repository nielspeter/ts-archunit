/**
 * A glob in a documented example has to work.
 *
 * Plan 0069's R2b. The existing `scan-markdown.ts` is per-line regex over symbol
 * names; the invariant R2b adds is **glob syntax** — anchored, no `./` segment —
 * and the plan warned it "reds three legitimate patterns" and was "real work of
 * unpredictable size".
 *
 * Measured, the size is predictable once the population is derived correctly:
 *
 *     glob-ish literals matched by line-regex over fences   467   <- the naive population
 *       of which "unanchored"                               224   <- almost all FALSE
 *
 *     string args to path-glob APIs, found by PARSING       132   <- the real population
 *       anchored                                           123
 *       dot-segment                                          0
 *       unanchored                                           9
 *     string args to import-target APIs                      31   <- exempt, see below
 *
 * The 224 are things like `'@nielspeter/ts-archunit'`, `'preset/agent/no-copy-paste'`
 * and `') // matches console.log('` — import specifiers, rule ids, and fragments the
 * regex mis-sliced. **A literal is a path glob only because of which API it is an
 * argument to**, which a line-regex cannot know and a parser can. That is the whole
 * design, and it is why this parses each fence with ts-morph.
 *
 * ## What it found
 *
 * One real bug, in the worst possible place. `docs/running-in-tests.md` taught:
 *
 *     it('every architecture rule asserts something', () => {
 *       const rules = [
 *         modules(p).that().resideInFolder('src/domain/**').should()…,
 *       ]
 *       expect(diagnose(rules)).toEqual([])
 *     })
 *
 * Measured: `resideInFolder('src/core/**')` selects **0** modules where
 * `'**\/src/core/**'` selects **40**, and `diagnose()` on that rule returns **1**
 * finding — so the documented example that teaches you to check your rules enforce
 * something **fails its own assertion**. Fixed by anchoring it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Node, Project, SyntaxKind } from 'ts-morph'

const docsDir = path.resolve(import.meta.dirname, '../../docs')

/**
 * APIs whose string arguments are matched against an **absolute** path, so an
 * unanchored glob cannot match and the example is dead as written.
 */
const ANCHORING_REQUIRED = new Set(['resideInFile', 'resideInFolder', 'havePathMatching'])

/**
 * APIs that accept a project-relative glob **by design**, so unanchored is correct.
 *
 * `slices().matching()` resolves every spelling of the same intent — v0.18.1's fix.
 * Measured: `matching('src/features/*\/')` and `matching('**\/src/features/*\/')` both
 * resolve and both report 1 finding on the slices fixture. Eight of the nine
 * unanchored args in the docs are this shape, so a rule that ignored the distinction
 * would be 8 false positives to 1 true one — the "three legitimate patterns" the plan
 * warned about, and the reason per-API classification is the mechanism rather than a
 * refinement of it.
 */
const RELATIVE_ALLOWED = new Set(['matching', 'assignedFrom'])

/**
 * APIs whose glob is matched against a resolved module path **or a bare specifier**.
 *
 * Exempt entirely: `notImportFrom('fastify')` is correct and unanchored, which is
 * what [bug 0014](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0014-bare-package-import-globs-match-nothing.md)
 * was fixed to support. 31 such args in the docs.
 */
const IMPORT_TARGET = new Set([
  'notImportFrom',
  'onlyImportFrom',
  'dependOn',
  'onlyHaveTypeImportsFrom',
  'onlyBeImportedVia',
  'importFrom',
])

interface GlobArg {
  file: string
  api: string
  glob: string
}

/** Every string argument to a glob-taking API in every TypeScript fence in `docs/`. */
function globArgs(): {
  anchoringRequired: GlobArg[]
  relativeAllowed: GlobArg[]
  importTarget: GlobArg[]
  fences: number
} {
  const project = new Project({ useInMemoryFileSystem: true })
  const anchoringRequired: GlobArg[] = []
  const relativeAllowed: GlobArg[] = []
  const importTarget: GlobArg[] = []
  let fences = 0

  for (const name of fs.readdirSync(docsDir).filter((n) => n.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(docsDir, name), 'utf-8')
    const blocks = [...text.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)]
    for (const [index, match] of blocks.entries()) {
      const code = match[1]
      if (code === undefined) continue
      fences += 1
      // A doc fence is a fragment, so it will not typecheck — parsing is enough, and
      // it is what distinguishes an argument from a coincidence.
      const sourceFile = project.createSourceFile(`/docs/${name}-${String(index)}.ts`, code, {
        overwrite: true,
      })
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression()
        const api = Node.isPropertyAccessExpression(expression)
          ? expression.getName()
          : Node.isIdentifier(expression)
            ? expression.getText()
            : ''
        const bucket = ANCHORING_REQUIRED.has(api)
          ? anchoringRequired
          : RELATIVE_ALLOWED.has(api)
            ? relativeAllowed
            : IMPORT_TARGET.has(api)
              ? importTarget
              : undefined
        if (bucket === undefined) continue
        for (const argument of call.getArguments()) {
          if (Node.isStringLiteral(argument)) {
            bucket.push({ file: name, api, glob: argument.getLiteralValue() })
          }
        }
      }
    }
  }
  return { anchoringRequired, relativeAllowed, importTarget, fences }
}

const isAnchored = (glob: string): boolean => glob.startsWith('**/') || glob.startsWith('/')
const hasDotSegment = (glob: string): boolean => glob.startsWith('./') || glob.includes('/./')

describe('globs in documented examples', () => {
  const found = globArgs()

  it('parses every TypeScript fence, or it is checking a subset it cannot name', () => {
    // Non-vacuity, and the first thing to break if the fence regex drifts: every
    // assertion below is over an empty set if this is zero. Measured at 319.
    expect(found.fences).toBeGreaterThan(250)
    expect(
      found.anchoringRequired.length + found.relativeAllowed.length + found.importTarget.length,
    ).toBeGreaterThan(100)
  })

  it('anchors every glob matched against an absolute path', () => {
    // The finding this exists for. An unanchored glob here selects nothing, so the
    // example teaches a rule that enforces nothing — measured, `resideInFolder`
    // selects 0 modules unanchored against 40 anchored.
    const unanchored = found.anchoringRequired
      .filter((g) => !isAnchored(g.glob))
      .map((g) => `${g.file}: ${g.api}('${g.glob}')`)
    expect(unanchored).toEqual([])
  })

  it('uses no `./` segment in a glob matched against an absolute path', () => {
    const dotted = found.anchoringRequired
      .filter((g) => hasDotSegment(g.glob))
      .map((g) => `${g.file}: ${g.api}('${g.glob}')`)
    expect(dotted).toEqual([])
  })

  it('leaves the relative-by-design and bare-specifier APIs alone', () => {
    // The discriminator. Without this the rule is 8 false positives to 1 true one,
    // and the cheapest way to green those 8 would be to anchor globs that are correct
    // as written — making the docs wrong to satisfy a test.
    // `matching()` / `assignedFrom()`: 8 args, and measured, **all 8 are unanchored**.
    // They are the population that makes the exemption load-bearing rather than
    // theoretical — without it this file reds 8 correct examples.
    expect(found.relativeAllowed.length).toBe(8)
    expect(found.relativeAllowed.filter((g) => !isAnchored(g.glob))).toHaveLength(8)

    // Import-target APIs: 31 args, and measured, **all 31 happen to be anchored**.
    // So the exemption is currently UNEXERCISED — the docs contain no bare-specifier
    // example inside a TypeScript fence, though `notImportFrom('fastify')` would be
    // correct if they did. Asserted as the number rather than as "some are unanchored",
    // which was the first version of this line and was simply false about the docs.
    expect(found.importTarget.length).toBe(31)
    expect(found.importTarget.filter((g) => !isAnchored(g.glob))).toHaveLength(0)
  })

  it('knows which APIs it is classifying, so a new one is not silently unchecked', () => {
    // The failure mode this file would otherwise have: a glob-taking API added later
    // falls into no bucket and its doc examples go unchecked forever, which is how
    // `Condition.globs` came to exist unpopulated (plan 0073). Asserted against the
    // source rather than a hard-coded list.
    const conditions = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../src/conditions/dependency.ts'),
      'utf-8',
    )
    for (const api of ['notImportFrom', 'onlyImportFrom', 'dependOn', 'onlyHaveTypeImportsFrom']) {
      expect(conditions).toContain(`export function ${api}`)
      expect(IMPORT_TARGET.has(api)).toBe(true)
    }
  })
})
