import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG': JSON.stringify(process.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG),
  }
})
