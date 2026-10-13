import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createToolsPreviewPlugin } from './tools-host/preview/plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), createToolsPreviewPlugin()],
  server: {
    fs: {
      // Preserve Vite's default sensitive-file deny list and isolate host code.
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/tools-host/**',
        '**/node_modules/.vite-temp/**',
      ],
    },
  },
})
