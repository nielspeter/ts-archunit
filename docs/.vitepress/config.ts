import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ts-archunit',
  description: 'Architecture testing for TypeScript',
  base: '/ts-archunit/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
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
          { text: 'Module Rules', link: '/modules' },
          { text: 'Class Rules', link: '/classes' },
          { text: 'Function Rules', link: '/functions' },
          { text: 'Type Rules', link: '/types' },
          { text: 'Body Analysis', link: '/body-analysis' },
          { text: 'Call Rules', link: '/calls' },
          { text: 'Pattern Templates', link: '/patterns' },
          { text: 'Slices & Layers', link: '/slices' },
          { text: 'Cross-Layer Validation', link: '/cross-layer' },
          { text: 'Smell Detection', link: '/smell-detection' },
          { text: 'GraphQL Rules', link: '/graphql' },
          { text: 'Standard Rules', link: '/standard-rules' },
          { text: 'Custom Rules', link: '/custom-rules' },
          { text: 'Violation Reporting', link: '/violation-reporting' },
        ],
      },
      {
        text: 'Reference',
        items: [{ text: 'API Reference', link: '/api-reference' }],
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
