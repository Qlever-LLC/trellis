import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const designDir = fileURLToPath(new URL("../design", import.meta.url));

export default defineConfig({
  server: {
    fs: {
      allow: [designDir],
    },
  },
  plugins: [tailwindcss(), sveltekit()],
});
