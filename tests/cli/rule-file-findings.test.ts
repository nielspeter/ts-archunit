/**
 * The finding a rule file gets when it could not be evaluated at all
 * (bug 0025).
 *
 * The behavioural half — that a throwing file no longer silences the run — is in
 * `check.test.ts`. This pins the finding's own shape, which sabotage found the
 * behavioural tests cannot see: they assert the file name reaches the output, and
 * it does so through the `Fix:` line, so emptying `file` and `line` left them
 * green while breaking the annotation surface underneath.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { attributeToRuleFile, ruleFileFailure } from '../../src/cli/rule-file-findings.js'
import { formatViolationsGitHub } from '../../src/core/format-github.js'
import { formatViolations } from '../../src/core/format.js'
import { severityFor } from '../../src/core/violation.js'

describe('ruleFileFailure', () => {
  const failure = ruleFileFailure('rules/arch.rules.ts', new RangeError('malformed rule'), 2)

  it('is located AT the rule file, which is the only locator it has', () => {
    // Not `file: ''`. A configuration finding from a builder has nowhere to point
    // — this one does, and the rule file is the thing the reader must open. The
    // attribution exists in the CLI's per-file loop and would otherwise be
    // discarded (the gap bug 0026 describes for the builder-raised findings).
    expect(failure.file).toBe('rules/arch.rules.ts')
    // And it renders as a location, not as a bare paragraph.
    expect(formatViolations([failure], undefined, { codeFrames: false })).toContain(
      'rules/arch.rules.ts',
    )
  })

  it('names the path ONCE, so a file outside the cwd stays readable', () => {
    // Measured on the real CLI: with the path in `rule`, `element`, the location
    // line and the remedy, one finding printed it four times — and the location
    // line runs it through `path.relative(cwd, …)`, so a rule file outside the
    // cwd rendered as `../../../../../../private/tmp/…`. The location line is
    // the one place it belongs.
    const outside = ruleFileFailure('/somewhere/else/deep/arch.rules.ts', new Error('boom'), 1)
    expect(outside.rule).not.toContain('/somewhere/else')
    expect(outside.element).not.toContain('/somewhere/else')
    expect(outside.suggestion).not.toContain('/somewhere/else')
    expect(outside.element).toBe('arch.rules.ts')
    // Still recoverable from the finding, in the field built for it.
    expect(outside.file).toBe('/somewhere/else/deep/arch.rules.ts')
  })

  it('does not run the error text into the sentence after it', () => {
    // "…(reading 'config') The other rule files…" — measured on the real CLI,
    // which is the only place the two strings meet.
    const unpunctuated = ruleFileFailure('a.ts', new Error("reading 'config'"), 2)
    expect(unpunctuated.message).toContain("reading 'config'. The other rule files")
    // An error that already ends in punctuation must not get a second period.
    const punctuated = ruleFileFailure('a.ts', new Error('got 1 side.'), 2)
    expect(punctuated.message).toContain('got 1 side. The other rule files')
    expect(punctuated.message).not.toContain('..')
  })

  it('uses line 1, because line 0 is not a valid annotation', () => {
    // `::error file=x,line=0` is dropped or misplaced by GitHub — the defect
    // fixed in v0.22.0 — and only `file: ''` takes the run-level branch that
    // avoids needing a line at all. With a file set, the line must be real.
    // Same choice `tsconfig()` makes for a fault that belongs to a file rather
    // than to a position in it.
    expect(failure.line).toBeGreaterThanOrEqual(1)
    const annotation = formatViolationsGitHub([failure])
    expect(annotation).toContain('file=rules/arch.rules.ts')
    expect(annotation).not.toContain('line=0')
    expect(annotation).toMatch(/line=[1-9]/)
  })

  it('is a configuration finding: error severity whatever the rule asked for', () => {
    // A rule file that could not run enforced nothing. That is not a violation
    // to grade, and not one to accept into a baseline.
    expect(failure.bypassFilters).toBe(true)
    expect(severityFor(failure, 'warn')).toBe('error')
  })

  it('carries the error text as evidence, and a remedy that does not assert a cause', () => {
    expect(failure.message).toContain('malformed rule')
    expect(failure.message).toContain('enforced nothing')
    // Conditional, because this fires for any error a rule file can raise — a
    // syntax error, a missing dependency, a misconfigured builder. Naming one
    // cause for all of them is the ADR-008 rule 2 defect.
    expect(failure.suggestion).toContain('this rule file')
    expect(failure.suggestion).toContain('If it names a builder method')
    // It must not claim to know which of those happened.
    expect(failure.message).not.toMatch(/syntax error|missing dependency|imports a test runner/)
  })

  it('mentions the other files only when there ARE other files', () => {
    // A one-file run saying "the other rule files were still checked" is a claim
    // about files that do not exist.
    const alone = ruleFileFailure('only.rules.ts', new Error('boom'), 1)
    expect(alone.message).not.toContain('other rule files')
    expect(failure.message).toContain('other rule files')
  })

  it('renders a non-Error throw without saying [object Object]', () => {
    // `throw 'a string'` and `throw {code: 1}` are both legal.
    expect(ruleFileFailure('r.ts', 'a bare string', 1).message).toContain('a bare string')
    expect(ruleFileFailure('r.ts', { code: 1 }, 1).message).not.toContain('undefined')
  })

  it('keeps the path as given, so it stays copyable', () => {
    // Not absolutized against the running cwd: the reported path is the one the
    // user typed on the command line, which is what they can paste back.
    const relative = ruleFileFailure('nested/dir/x.rules.ts', new Error('e'), 1)
    expect(relative.file).toBe('nested/dir/x.rules.ts')
    expect(path.isAbsolute(relative.file)).toBe(false)
  })
})

describe('attributeToRuleFile', () => {
  const configFinding = {
    rule: 'my/rule-id',
    element: 'my/rule-id',
    file: '',
    line: 0,
    message: 'this rule asserts nothing and can never fail',
    suggestion: 'Add a condition after .should()',
    bypassFilters: true,
  }

  it('stamps the rule file onto a finding that has no location of its own', () => {
    const [stamped] = attributeToRuleFile([configFinding], 'rules/arch.rules.ts')
    expect(stamped?.file).toBe('rules/arch.rules.ts')
    expect(stamped?.line).toBe(1)
    // Everything else is untouched — the identity, the remedy, the flag.
    expect(stamped?.rule).toBe('my/rule-id')
    expect(stamped?.suggestion).toBe(configFinding.suggestion)
    expect(stamped?.bypassFilters).toBe(true)
  })

  it('leaves a violation that already has a location alone', () => {
    // Ordinary violations point at the code they found, not at the rule file
    // that declared the rule. Overwriting that would be the whole feature
    // backwards.
    const located = {
      ...configFinding,
      file: '/src/service.ts',
      line: 42,
      bypassFilters: undefined,
    }
    const [same] = attributeToRuleFile([located], 'rules/arch.rules.ts')
    expect(same?.file).toBe('/src/service.ts')
    expect(same?.line).toBe(42)
  })

  it('makes two identical vacuous rules distinguishable', () => {
    // The reported symptom: two rule files each holding the same vacuous rule
    // rendered as two identical paragraphs, with nothing saying which to open.
    const a = attributeToRuleFile([configFinding], 'a.rules.ts')
    const b = attributeToRuleFile([configFinding], 'b.rules.ts')
    const rendered = formatViolations([...a, ...b], undefined, { codeFrames: false })
    expect(rendered).toContain('a.rules.ts')
    expect(rendered).toContain('b.rules.ts')
  })

  it('produces a file-level GitHub annotation with a usable line', () => {
    // Before: `file: ''` took the run-level branch, so 40 vacuous rules across 6
    // files all landed on the workflow summary with no way to tell them apart.
    const stamped = attributeToRuleFile([configFinding], 'rules/arch.rules.ts')
    const annotation = formatViolationsGitHub(stamped)
    expect(annotation).toContain('file=rules/arch.rules.ts')
    expect(annotation).not.toContain('line=0')
    expect(annotation).toMatch(/line=[1-9]/)
  })

  it('does not resurrect the double-printed remedy', () => {
    // A configuration finding whose `suggestion` IS its `message` used to rely on
    // `file === ''` to be rendered once. Stamping a file changes which branch it
    // takes, so the count is asserted here too — this is the third time in this
    // release that the remedy could have started printing twice.
    const selfRemedy = { ...configFinding, suggestion: configFinding.message }
    const out = formatViolations(attributeToRuleFile([selfRemedy], 'a.rules.ts'), undefined, {
      codeFrames: false,
    })
    expect(out.split(selfRemedy.message).length - 1).toBe(1)
  })
})
