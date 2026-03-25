import { sveltekit } from "npm:@sveltejs/kit/vite";
import tailwindcss from "npm:@tailwindcss/vite";
import { defineConfig } from "npm:vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
