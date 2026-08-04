/**
 * `jsxElements()` against `.tsx` files **on disk**, through a real tsconfig.
 *
 * [Bug 0051](../../bugs/fixed/0051-the-jsx-entry-point-has-never-run-against-a-file-on-disk.md):
 * before this file there was not one `.tsx` or `.jsx` file anywhere in the
 * repository. Every JSX test built its sources in memory —
 * `useInMemoryFileSystem: true` then `createSourceFile('test.tsx', code)` — and set
 * `jsx: ts.JsxEmit.React` itself. So the path an adopter takes had never executed:
 * `project('tsconfig.json')`, real files, file **discovery** reaching `.tsx`, and a
 * `jsx` setting coming from the tsconfig rather than from the test.
 *
 * `docs/jsx.md` is 257 lines standing on that path.
 *
 * Found by two independent reviewers of plan 0083. The plan itself had filed it as
 * *reassurance* — "only 8 of the 125 unapplied primitives are JSX- or GraphQL-shaped"
 * — which measures API surface rather than risk. GraphQL, in the same class, had a
 * real fixture on disk all along; JSX was the one that did not.
 *
 * ## What is deliberately NOT in memory here
 *
 * Everything. The fixture carries its own `tsconfig.json` with `"jsx": "preserve"`,
 * and the root `tsconfig.json` **excludes** it — because the root program sets no
 * `jsx` and would fail `npm run typecheck` with TS17004 before any test ran. That
 * exclusion, and the `*.tsx` pathspec added to `format:check`, are part of this fix:
 * each of them reds the build in a step *before* the tests, which is the failure
 * that looks like nothing in the working tree.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { project, jsxElements, areComponents } from '../../src/index.js'
import type { ArchProject } from '../../src/core/project.js'
import { isRecord } from '../../src/core/type-guards.js'

const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures/jsx-on-disk')

function load(): ArchProject {
  return project(path.join(fixtureRoot, 'tsconfig.json'))
}

/** `relpath:tag`, so assertions name elements rather than count them. */
const identify = (
  els: readonly { getName: () => string; getSourceFile: () => { getFilePath: () => string } }[],
): string[] =>
  els
    .map((e) => `${path.relative(fixtureRoot, e.getSourceFile().getFilePath())}:${e.getName()}`)
    .sort()

describe('jsxElements() reaches .tsx files on disk (bug 0051)', () => {
  it('VACUITY: the fixture really is on disk and really is .tsx', () => {
    // Without this the rows below could pass over an empty selection — which is
    // exactly the state that made the bug invisible, so it is asserted first and
    // without using the library at all.
    const onDisk = fs
      .readdirSync(path.join(fixtureRoot, 'src'), { recursive: true, encoding: 'utf-8' })
      .filter((f) => f.endsWith('.tsx'))
      .sort()
    expect(onDisk).toEqual([path.join('components', 'Button.tsx'), path.join('pages', 'Home.tsx')])
  })

  it("the fixture's tsconfig really configures JSX, which is what makes it a fixture", () => {
    // Measured, and it surprised me: **discovery does not need `jsx` set.** Removing
    // it from this tsconfig leaves every row below passing, because ts-morph parses
    // `.tsx` syntax regardless — the setting governs type-checking, not parsing.
    //
    // Which is good news for an adopter with a half-configured tsconfig, and bad
    // news for a fixture: without this row, the file could drift into not being a
    // JSX project at all while still "proving" JSX works. So the configuration is
    // asserted directly rather than assumed from the file extension.
    //
    // `preserve` rather than `react-jsx`: the latter demands `react/jsx-runtime`
    // types, and pulling in `@types/react` would parse the whole React type graph on
    // every load of this program for no benefit to what is being tested.
    const tsconfig: unknown = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'tsconfig.json'), 'utf-8'),
    )
    // `isRecord`, not a cast — ADR-005, and it exists because bug 0049 found four
    // `as` casts in shipped source and one duplicated guard.
    const options = isRecord(tsconfig) ? tsconfig['compilerOptions'] : undefined
    expect(isRecord(options) ? options['jsx'] : undefined).toBe('preserve')
  })

  it('discovers JSX elements across .tsx files, by identity', () => {
    // The step every in-memory test skips: file DISCOVERY. `project()` resolves the
    // tsconfig, ts-morph enumerates `.tsx` under `include`, and the entry point has
    // to find them without anyone naming a file.
    expect(identify(jsxElements(load()).subjects())).toEqual([
      'src/components/Button.tsx:button',
      'src/pages/Home.tsx:Button',
      'src/pages/Home.tsx:div',
      'src/pages/Home.tsx:img',
    ])
  })

  it('a predicate narrows the on-disk selection', () => {
    // `areComponents()` distinguishes a component from an intrinsic tag, which is
    // the discrimination `docs/jsx.md` teaches first.
    expect(identify(jsxElements(load()).that().satisfy(areComponents()).subjects())).toEqual([
      'src/pages/Home.tsx:Button',
    ])
  })

  it('a rule from the docs fires on a file on disk', () => {
    // `docs/jsx.md` teaches `notContain(jsxElement('script'))` for pages; the same
    // shape against a tag the fixture does have, so the rule REPORTS rather than
    // passing vacuously.
    const violations = jsxElements(load())
      .that()
      .satisfy(areComponents())
      .should()
      .notExist()
      .violations()

    // `<Button>`, angle brackets included — the element format the reader sees.
    expect(violations.map((v) => v.element)).toEqual(['<Button>'])
  })

  it('an accessibility rule from the docs fires: an img with no alt', () => {
    // `docs/jsx.md` teaches exactly this as its accessibility example, and the
    // fixture's `<img src="/logo.png" />` has no `alt`. Asserted by identity.
    const violations = jsxElements(load())
      .that()
      .areHtmlElements('img')
      .should()
      .haveAttribute('alt')
      .violations()

    expect(violations.map((v) => v.element)).toEqual(['<img>'])
  })

  it('CONTROL: a selector for a tag the fixture lacks is a dead selector, not a pass', () => {
    // The other direction — and the interesting one. `script` appears nowhere, so
    // this reports a CONFIGURATION finding (the selector matched nothing) rather
    // than passing silently. That is the library's own thesis applied to itself, and
    // it is why the row above cannot be passing merely because everything reports.
    const violations = jsxElements(load())
      .that()
      .areHtmlElements('script')
      .should()
      .haveAttribute('nonce')
      .violations()

    expect(violations.map((v) => v.bypassFilters === true)).toEqual([true])
  })
})
