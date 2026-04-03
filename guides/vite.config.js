import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "npm:@sveltejs/kit/vite";
import tailwindcss from "npm:@tailwindcss/vite";
import { defineConfig } from "npm:vite";

const designDir = fileURLToPath(new URL("../design", import.meta.url));

export default defineConfig({
  server: {
    fs: {
      allow: [designDir],
    },
  },
  plugins: [tailwindcss(), sveltekit()],
});
