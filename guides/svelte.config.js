import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "npm:@sveltejs/adapter-static";
import { vitePreprocess } from "npm:@sveltejs/vite-plugin-svelte";
import { escapeSvelte, mdsvex } from "npm:mdsvex";
import rehypeAutolinkHeadings from "npm:rehype-autolink-headings";
import rehypeSlug from "npm:rehype-slug";
import remarkGfm from "npm:remark-gfm";
import { codeToHtml } from "npm:shiki";

const githubRepository = process.env.GITHUB_REPOSITORY;
const guidesRoot = fileURLToPath(new URL(".", import.meta.url));
const basePath = process.env.SITE_BASE_PATH ?? (githubRepository ? `/${githubRepository.split("/")[1]}` : "");
const designRoot = fileURLToPath(new URL("../design", import.meta.url));

function collectMarkdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectMarkdownFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

const designPrerenderEntries = collectMarkdownFiles(designRoot).map((filePath) => {
  const relativePath = path.relative(designRoot, filePath).replaceAll("\\", "/");
  const slug = relativePath
    .replace(/\.md$/i, "")
    .replace(/(?:^|\/)README$/i, "");

  return slug ? `/design/${slug}` : "/design";
});

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

function rewriteDesignDocLinks() {
  return function transformer(tree) {
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") {
        return;
      }

      const href = node.properties?.href;
      if (typeof href !== "string") {
        return;
      }

      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("#") ||
        href.startsWith("//")
      ) {
        return;
      }

      const match = href.match(/^((?:\.{1,2}\/|\/design\/|design\/)[^?#]+)\.md((?:[?#].*)?)$/);
      if (!match) {
        return;
      }

      const [, markdownPath, suffix = ""] = match;
      if (markdownPath.startsWith("design/")) {
        node.properties.href = `/${markdownPath.replace(/\.md$/i, "")}${suffix}`;
        return;
      }

      node.properties.href = `${markdownPath.replace(/\.md$/i, "")}${suffix}`;
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

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function highlighter(code, lang) {
  const language = lang || "text";

  if (language === "mermaid") {
    return escapeSvelte(
      `<pre class="shiki github-dark-default" style="background-color:#0d1117;color:#e6edf3"><code class="language-mermaid">${escapeHtml(code)}</code></pre>`,
    );
  }

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
  extensions: [".svelte", ".svx", ".md"],
  preprocess: [
    vitePreprocess(),
    mdsvex({
      extensions: [".svx", ".md"],
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
        rewriteDesignDocLinks,
        [prefixRootLinks, basePath],
      ],
    }),
  ],
  kit: {
    alias: {
      $design: designRoot,
    },
    paths: {
      base: basePath,
    },
    prerender: {
      entries: ["*", ...designPrerenderEntries],
    },
    adapter: adapter({
      pages: "build",
      assets: "build",
    }),
  },
};

export default config;
