<script lang="ts">

  import type { Snippet } from "svelte";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import {
    getGuideDoc,
    getGuidePrevNext,
    guideSidebarBySection,
  } from "$lib/docs";

  let { children }: { children: Snippet } = $props();

  const groups = guideSidebarBySection();
  const pathname = $derived(normalizePath(stripBasePath(page.url.pathname)));
  const currentDoc = $derived(getGuideDoc(pathname));
  const neighbors = $derived(getGuidePrevNext(pathname));
  const title = $derived(
    `${currentDoc?.title || "Guides"} | Trellis documentation`,
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
</svelte:head>

<div class="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
  <aside class="lg:sticky lg:top-6">
    <div class="rounded-box border border-base-300 bg-base-100">
      <div class="border-b border-base-300 px-4 py-3">
        <h2 class="text-sm font-semibold">Guides</h2>
      </div>

      <nav class="p-2" aria-label="Documentation">
        {#each groups as group (group.section)}
          <p class="mt-3 first:mt-1 px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-base-content/40">
            {group.section}
          </p>

          {#each group.items as item (item.kind === "doc" ? item.doc.href : item.label)}
            {#if item.kind === "group"}
              <div class="px-3 py-2">
                <p class="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/50">
                  {item.label}
                </p>
                <div class="mt-2 space-y-1 border-l border-base-300 pl-3">
                  {#each item.docs as doc (doc.href)}
                    <a
                      class={[
                        "block rounded-btn px-2 py-1 text-sm hover:bg-base-200/50",
                        pathname === doc.href
                          ? "bg-base-200 font-medium text-base-content"
                          : "text-base-content/75",
                      ]}
                      href={resolveDocHref(doc.href)}
                    >
                      <span class="block">{doc.sidebarLabel ?? doc.title}</span>
                    </a>
                  {/each}
                </div>
              </div>
            {:else}
              <a
                class={[
                  "block rounded-btn px-3 py-2 text-sm hover:bg-base-200/50",
                  pathname === item.doc.href
                    ? "bg-base-200 font-medium text-base-content"
                    : "text-base-content/75",
                ]}
                href={resolveDocHref(item.doc.href)}
              >
                <span class="block">{item.doc.title}</span>
              </a>
            {/if}
          {/each}
        {/each}
      </nav>
    </div>
  </aside>

  <div class="min-w-0 space-y-6">
    {#if currentDoc}
      {#if currentDoc.showPageHeader !== false}
        <section class="space-y-2 border-b border-base-300 pb-5">
          <p
            class="text-xs font-medium uppercase tracking-[0.16em] text-base-content/50"
          >
            {currentDoc.section}
          </p>
          <div>
            <h1 class="text-3xl font-semibold">{currentDoc.title}</h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-base-content/70">
              {currentDoc.description}
            </p>
          </div>
        </section>
      {/if}

      <article
        class="rounded-box border border-base-300 bg-base-100 p-5 sm:p-6"
      >
        <div class="docs-prose prose max-w-none">
          {@render children()}
        </div>
      </article>

      {#if neighbors.prev || neighbors.next}
        <nav class="grid gap-4 md:grid-cols-2" aria-label="Guide pagination">
          {#if neighbors.prev}
            <a
              class="rounded-box border border-base-300 bg-base-100 p-4 hover:bg-base-200/40"
              href={resolveDocHref(neighbors.prev.href)}
            >
              <span
                class="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/45"
                >Previous</span
              >
              <span class="mt-2 block text-base font-semibold"
                >{neighbors.prev.title}</span
              >
              <span class="mt-1 block text-xs text-base-content/50"
                >{neighbors.prev.section}</span
              >
            </a>
          {:else}
            <div class="hidden md:block"></div>
          {/if}

          {#if neighbors.next}
            <a
              class="rounded-box border border-base-300 bg-base-100 p-4 hover:bg-base-200/40 md:text-right"
              href={resolveDocHref(neighbors.next.href)}
            >
              <span
                class="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/45"
                >Next</span
              >
              <span class="mt-2 block text-base font-semibold"
                >{neighbors.next.title}</span
              >
              <span class="mt-1 block text-xs text-base-content/50"
                >{neighbors.next.section}</span
              >
            </a>
          {/if}
        </nav>
      {/if}
    {:else}
      {@render children()}
    {/if}
  </div>
</div>
