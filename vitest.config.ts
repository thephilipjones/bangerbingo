import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    // `browser` condition ensures svelte resolves to the client runtime (needed for
    // component-mount tests using @testing-library/svelte + jsdom).
    conditions: ['browser'],
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
