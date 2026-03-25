import adapter from "npm:@sveltejs/adapter-static";
import { vitePreprocess } from "npm:@sveltejs/vite-plugin-svelte";
import { escapeSvelte, mdsvex } from "npm:mdsvex";
import rehypeAutolinkHeadings from "npm:rehype-autolink-headings";
import rehypeSlug from "npm:rehype-slug";
import remarkGfm from "npm:remark-gfm";
import { codeToHtml } from "npm:shiki";

const githubRepository = process.env.GITHUB_REPOSITORY;
const basePath = githubRepository ? `/${githubRepository.split("/")[1]}` : "";

function prefixRootLinks(base) {
  return function transformer(tree) {
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") {
        return;
      }

      const href = node.properties?.href;
      if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) {
        return;
      }

      node.properties.href = base ? `${base}${href}` : href;
    });
  };
}

function visit(node, callback) {
  callback(node);
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return;
  }
  for (const child of node.children) {
    visit(child, callback);
  }
}

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
        [prefixRootLinks, basePath],
      ],
    }),
  ],
  kit: {
    paths: {
      base: basePath,
    },
    adapter: adapter({
      pages: "build",
      assets: "build",
    }),
  },
};

export default config;
