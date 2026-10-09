import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createToolsPreviewPlugin } from './tools-host/preview/plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), createToolsPreviewPlugin()],
})
