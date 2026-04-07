import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/shiny-enigma/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
