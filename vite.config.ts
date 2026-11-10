import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { parse } from 'yaml'

/** Turn `import x from './file.yaml'` into plain JSON at build time. */
function yamlPlugin(): Plugin {
  return {
    name: 'yaml',
    transform(code, id) {
      if (!id.endsWith('.yaml')) return null
      return { code: `export default ${JSON.stringify(parse(code))}`, map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/ask-me-anything/',
  plugins: [yamlPlugin(), react()],
})
