import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GH_PAGES=true is set only by the GitHub Pages build step (see .github/workflows/deploy.yml),
// so local dev and any other deploy target (e.g. Railway) keep serving from the root path.
const ghPages = process.env.GH_PAGES === 'true'

// https://vite.dev/config/
export default defineConfig({
  base: ghPages ? '/mml-study-planner/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
