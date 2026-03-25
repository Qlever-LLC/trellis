import adapter from "npm:@sveltejs/adapter-static";
import { vitePreprocess } from "npm:@sveltejs/vite-plugin-svelte";
import { escapeSvelte, mdsvex } from "npm:mdsvex";
import rehypeAutolinkHeadings from "npm:rehype-autolink-headings";
import rehypeSlug from "npm:rehype-slug";
import remarkGfm from "npm:remark-gfm";
import { codeToHtml } from "npm:shiki";

async function highlighter(code, lang) {
  const language = lang || "text";
  try {
    const html = await codeToHtml(code, {
      lang: language,
      theme: "github-dark-default",
    });
    return escapeSvelte(html.replace(/\s+tabindex="0"/g, ""));
  } catch {
    const html = await codeToHtml(code, {
      lang: "text",
      theme: "github-dark-default",
    });
    return escapeSvelte(html.replace(/\s+tabindex="0"/g, ""));
  }
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  extensions: [".svelte", ".svx"],
  preprocess: [
    vitePreprocess(),
    mdsvex({
      extensions: [".svx"],
      highlight: {
        highlighter,
        alias: {
          sh: "bash",
          shell: "bash",
          ts: "typescript",
          yml: "yaml",
        },
      },
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: "append", properties: { ariaHidden: "true", className: ["heading-anchor"] } }],
      ],
    }),
  ],
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
    }),
  },
};

export default config;
