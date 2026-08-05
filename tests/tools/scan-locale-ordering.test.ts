/**
 * No identity-bearing sort may use `localeCompare` — enforced by scanning the source, because
 * a runtime row provably cannot catch it.
 *
 * ## Why this is a source scan and not a test
 *
 * `String.prototype.localeCompare` with no explicit locale reads the **host** locale from
 * `LANG`/`LC_ALL`. So a baseline identity derived from such a sort differs between a
 * developer's machine and CI — one finding, two hashes, diverging in the place hardest to
 * debug.
 *
 * A behavioural row cannot see it. On an `en-US` machine `localeCompare` and codepoint order
 * agree for every ASCII pair anyone would write in a fixture, so the row passes with the defect
 * present. **Measured**: a row asserting the discriminator for `import { zebra, aardvark }`
 * equals `aardvark,zebra` passed **16/16 with `localeCompare` reinstated**. Running the whole
 * suite under `LC_ALL=da_DK.UTF-8` also passed — 3177/3177 — because the fixtures that would
 * separate the two do not exist. A guard written for this defect, that cannot detect this
 * defect, is exactly what ADR-008 rule 5 is about.
 *
 * The pair that separates them needs no unusual characters: Danish collates `aa` as `å`, after
 * `z`, so `['zebra','aardvark']` sorts to `zebra,aardvark` under `da-DK` and `aardvark,zebra`
 * everywhere else. This project's author works on a Danish machine; CI runs with no `LANG`, so
 * ICU defaults to `en-US`. The divergence appears only between the two.
 *
 * ## What the codebase already knew
 *
 * `src/core/module-edges.ts` wrote, sixty lines above a `localeCompare` in the identity
 * discriminator: *"`localeCompare` is ICU/locale sensitive — exactly the machine-dependent
 * ordering `conditions/slice.ts` goes out of its way to eliminate, because a value that differs
 * per machine gives one finding two identities."* And `conditions/slice.ts` eliminated its own
 * machine-dependence **using `localeCompare`**, in three places, one of which sorts the cycle
 * `element` that `hashViolation` keys on when no `identity` is set.
 *
 * Four sites shipped in v0.56.0. The prose was right and nothing enforced it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * Files whose sorts can reach a baseline identity, an `element`, or a reported location.
 *
 * Deliberately a directory sweep rather than a hand-listed file set: the defect was filed
 * against one file, and the sweep found four sites across three. A list would have gone stale
 * the first time a condition moved.
 */
const IDENTITY_BEARING = ['src/core/**/*.ts', 'src/conditions/**/*.ts', 'src/helpers/**/*.ts']

/**
 * Sorts that cannot reach identity, each justified at its site.
 *
 * A sort that only orders **output** — the sequence findings are printed in — is free to be
 * locale-aware, because nothing hashes it. Anything that feeds `identity`, `element`, `file`,
 * `line` or a message is not.
 */
const ALLOWED = new Set<string>([])

describe('a machine-dependent sort cannot reach a baseline identity', () => {
  it('no identity-bearing source uses localeCompare', () => {
    const offenders: string[] = []

    for (const pattern of IDENTITY_BEARING) {
      for (const file of globSync(pattern, { cwd: ROOT })) {
        const rel = file.split(path.sep).join('/')
        if (ALLOWED.has(rel)) continue
        const text = readFileSync(path.join(ROOT, file), 'utf8')
        text.split('\n').forEach((line, i) => {
          // Skip prose: this file's own explanation names the method repeatedly, and so do the
          // docstrings recording why each site was changed.
          const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
          if (code.includes('localeCompare')) offenders.push(`${rel}:${String(i + 1)}`)
        })
      }
    }

    expect(
      offenders,
      `these sorts can reach a baseline identity and read the host locale, so the same finding ` +
        `hashes differently on a developer's machine and in CI. Use \`byCodepoint\` from ` +
        `\`src/core/violation.ts\`. If a sort here genuinely only orders printed output, add it ` +
        `to ALLOWED with the reason at its site.`,
    ).toEqual([])
  })

  it('and byCodepoint disagrees with localeCompare, so the rule is not cosmetic', () => {
    // The differently-derived value: if these agreed, the scan above would be pedantry.
    expect(['zebra', 'aardvark'].sort((a, b) => a.localeCompare(b, 'da-DK')).join(',')).toBe(
      'zebra,aardvark',
    )
    expect(['zebra', 'aardvark'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')).toBe(
      'aardvark,zebra',
    )
  })
})
