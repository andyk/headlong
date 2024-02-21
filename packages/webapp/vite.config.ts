import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.OPENAI_API_KEY": JSON.stringify(process.env.OPENAI_API_KEY),
    // "import.meta.env.OPENAI_ORG": JSON.stringify(process.env.OPENAI_ORG),  // This environment var isn't actually being used
    "import.meta.env.HF_API_KEY": JSON.stringify(process.env.HF_API_KEY),
    "import.meta.env.HF_LLAMA_ENDPOINT": JSON.stringify(process.env.HF_LLAMA_ENDPOINT),
    "import.meta.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG": JSON.stringify(
      process.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG
    ),
  },
});
