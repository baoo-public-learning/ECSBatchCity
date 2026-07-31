import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  build: {
    target: 'es2022',
    // three.js本体のchunkは522kB。分割済みでこれ以上は縮まないため上限を明示する。
    chunkSizeWarningLimit: 560,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue') || id.includes('node_modules/pinia')) return 'vue'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
