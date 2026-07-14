import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ts-archunit',
  description: 'Architecture testing for TypeScript',
  base: '/ts-archunit/',

  themeConfig: {
    nav: [
      { text: 'Get Started', link: '/getting-started' },
      { text: 'Guide', link: '/setup-best-practices' },
      { text: 'What to Check', link: '/what-to-check' },
      { text: 'CLI', link: '/cli' },
      { text: 'API', link: '/api-reference' },
      { text: 'GitHub', link: 'https://github.com/NielsPeter/ts-archunit' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is ts-archunit?', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'What to Check', link: '/what-to-check' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Core Concepts', link: '/core-concepts' },
          { text: 'Setup & Best Practices', link: '/setup-best-practices' },
          { text: 'Running Rules in Tests', link: '/running-in-tests' },
          { text: 'Architecture Presets', link: '/presets' },
          { text: 'AI Agents', link: '/ai-agents' },
          { text: 'Custom Rules', link: '/custom-rules' },
          { text: 'Violation Reporting', link: '/violation-reporting' },
        ],
      },
      {
        text: 'Rule Catalog',
        items: [
          { text: 'Module Rules', link: '/modules' },
          { text: 'Class Rules', link: '/classes' },
          { text: 'Function Rules', link: '/functions' },
          { text: 'Type Rules', link: '/types' },
          { text: 'Call Rules', link: '/calls' },
          { text: 'JSX Element Rules', link: '/jsx' },
          { text: 'Slices & Layers', link: '/slices' },
          { text: 'Body Analysis', link: '/body-analysis' },
          { text: 'Pattern Templates', link: '/patterns' },
          { text: 'Cross-Layer Validation', link: '/cross-layer' },
          { text: 'Smell Detection', link: '/smell-detection' },
          { text: 'Metrics', link: '/metrics' },
          { text: 'Enforce Compiler Options', link: '/config-rules' },
          { text: 'GraphQL Rules', link: '/graphql' },
          { text: 'Standard Rules', link: '/standard-rules' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/cli' },
          { text: 'Explain Command', link: '/explain' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'API Reference', link: '/api-reference' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
