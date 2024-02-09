import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.OPENAI_API_KEY": JSON.stringify(process.env.OPENAI_API_KEY),
    "import.meta.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG": JSON.stringify(
      process.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG
    ),
  },
});
