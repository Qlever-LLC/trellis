<script lang="ts">
  import { error } from "@sveltejs/kit";
  import type { Component } from "svelte";
  import type { PageProps } from "./$types";

  let { params }: PageProps = $props();

  const designModules = import.meta.glob("$design/**/*.md", { eager: true }) as Record<
    string,
    { default: Component }
  >;

  const designEntries = Object.entries(designModules)
    .map(([path, module]) => ({
      slug: path
        .replace(/^\$design\//, "")
        .replace(/^.*\/design\//, "")
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")
        .replace(/(?:^|\/)README$/i, ""),
      module,
    }))
    .filter((entry) => entry.slug.length > 0);

  const designModulesBySlug = Object.fromEntries(
    designEntries.map(({ slug, module }) => [slug, module]),
  ) as Record<string, { default: Component }>;

  function normalizeSlug(slug: string) {
    return slug
      .replace(/\/+$/, "")
      .replace(/\.md$/i, "")
      .replace(/(?:^|\/)README$/i, "");
  }

  function getCurrentDoc(slug: string) {
    const currentModule = designModulesBySlug[normalizeSlug(slug)];

    if (!currentModule?.default) {
      throw error(404, "Design document not found");
    }

    return currentModule.default;
  }
</script>

{#key params.slug}
  {@const CurrentDoc = getCurrentDoc(params.slug)}
  <CurrentDoc />
{/key}
