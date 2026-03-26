---
layout: home
hero:
  name: ts-archunit
  text: Architecture Testing for TypeScript
  tagline: Enforce structural rules across your codebase as executable tests
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/NielsPeter/ts-archunit

features:
  - title: Rules as Tests
    details: Architecture rules run in vitest/jest. CI catches violations before code review.
  - title: Body Analysis
    details: Inspect what happens inside functions — no other TS tool does this. Detect banned calls, wrong constructors, missing patterns.
  - title: Type Checking
    details: Distinguish bare string from typed unions. Resolves through aliases, Partial<>, Pick<>.
  - title: Layer Enforcement
    details: Enforce dependency direction between layers. Detect cycles between feature modules.
  - title: Standard Rules
    details: Ready-to-use rules for TypeScript strictness, security, naming, and error handling — just import and apply.
  - title: Rich Violations
    details: Code frames, line numbers, suggestions, and docs links. GitHub Actions annotations out of the box.
---
