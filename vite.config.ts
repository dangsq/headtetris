import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/headtetris/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        headtetris: resolve(__dirname, 'headtetris/index.html'),
      },
    },
  },
})
