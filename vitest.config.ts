import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite'

export default defineConfig({
  plugins: [sveltePhosphorOptimize(), svelte({ hot: false })],
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
