<script lang="ts">
  import type { Snippet } from "svelte";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import {
    getDesignDoc,
    getDesignPrevNext,
  } from "$lib/docs";

  let { children }: { children: Snippet } = $props();

  const pathname = $derived(normalizePath(stripBasePath(page.url.pathname)));
  const currentDoc = $derived(getDesignDoc(pathname));
  const neighbors = $derived(getDesignPrevNext(pathname));
  const title = $derived(
    `${currentDoc?.title || "Design"} | Trellis documentation`,
  );

  function normalizePath(path: string) {
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }

  function stripBasePath(pathname: string) {
    if (!base) {
      return pathname;
    }

    if (pathname === base) {
      return "/";
    }

    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  }

  function resolveDocHref(href: string) {
    if (!base) {
      return href;
    }

    return href === "/" ? `${base}/` : `${base}${href}`;
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={currentDoc?.description} />
  <script src={base ? `${base}/mermaid.min.js` : "/mermaid.min.js"} defer></script>
  <script src={base ? `${base}/mermaid-init.js` : "/mermaid-init.js"} data-base={base} defer></script>
</svelte:head>

<div class="min-w-0 space-y-6">
  {#if currentDoc}
    {#if currentDoc.showPageHeader !== false}
      <section class="space-y-2 border-b border-base-300 pb-5">
        <p class="docs-section-label">
          {currentDoc.section}
        </p>
        <div>
          <h1 class="text-3xl font-semibold">{currentDoc.title}</h1>
          <p class="docs-metadata mt-2 max-w-3xl">
            {currentDoc.description}
          </p>
        </div>
      </section>
    {/if}

    <article class="docs-panel p-5 sm:p-6">
      <div class="docs-prose prose max-w-none">
        {@render children()}
      </div>
    </article>

    {#if neighbors.prev || neighbors.next}
      <nav class="grid gap-4 md:grid-cols-2" aria-label="Design pagination">
        {#if neighbors.prev}
          <a
            class="docs-pagination-link docs-panel p-4"
            href={resolveDocHref(neighbors.prev.href)}
          >
            <span class="docs-section-label">Previous</span>
            <span class="docs-pagination-link-title mt-2 block">{neighbors.prev.title}</span>
            <span class="docs-metadata mt-1 block">{neighbors.prev.section}</span>
          </a>
        {:else}
          <div class="hidden md:block"></div>
        {/if}

        {#if neighbors.next}
          <a
            class="docs-pagination-link docs-panel p-4 md:text-right"
            href={resolveDocHref(neighbors.next.href)}
          >
            <span class="docs-section-label">Next</span>
            <span class="docs-pagination-link-title mt-2 block">{neighbors.next.title}</span>
            <span class="docs-metadata mt-1 block">{neighbors.next.section}</span>
          </a>
        {/if}
      </nav>
    {/if}
  {:else}
    {@render children()}
  {/if}
</div>
