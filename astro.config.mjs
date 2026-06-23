// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://dope-rs.github.io',
  integrations: [
    starlight({
      title: 'dope-rs',
      favicon: '/favicon.svg',
      tagline: 'An ecosystem built on one rule: nothing is shared.',
      description:
        'dope-rs is a thread-per-core Rust ecosystem — no atomics, no dyn, no inter-thread communication. The manifold runtime (dope), its database drivers (cartel), and its web framework (sark).',
      logo: {
        light: './src/assets/mark-light.svg',
        dark: './src/assets/mark-dark.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/dope-rs',
        },
      ],
      customCss: ['./src/styles/theme.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'philosophy/intro' },
            { label: 'Features', slug: 'philosophy/features' },
          ],
        },
        {
          label: 'Core concepts',
          items: [
            { label: 'Manifold', slug: 'concepts/manifold' },
            { label: 'Fiber', slug: 'concepts/fiber' },
          ],
        },
        {
          label: 'The stack',
          items: [
            { label: 'dope', slug: 'stack/dope' },
            { label: 'shin', slug: 'stack/shin' },
            { label: 'sark', slug: 'stack/sark' },
            { label: 'cartel', slug: 'stack/cartel' },
            { label: 'tent', slug: 'stack/tent' },
          ],
        },
      ],
      pagination: true,
      lastUpdated: false,
      credits: false,
    }),
  ],
});
