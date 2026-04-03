<script lang="ts">
  import { base } from "$app/paths";
  import { overviewDocsBySection } from "$lib/docs";

  const groups = overviewDocsBySection();

  function resolveDocHref(href: string) {
    if (!base) {
      return href;
    }

    return href === "/" ? `${base}/` : `${base}${href}`;
  }
</script>

<svelte:head>
  <title>Trellis documentation</title>
  <meta
    name="description"
    content="Trellis product documentation for customers using the installed CLI, published packages, and release assets."
  />
</svelte:head>

<div class="space-y-8">
  <section class="space-y-3">
    <p class="text-sm text-base-content/60">Documentation</p>
    <h1 class="text-3xl font-semibold sm:text-4xl">Trellis Documentation</h1>
  </section>

  {#each groups as group (group.section)}
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-base-content/50">
        {group.section}
      </h2>
      <div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <ul class="divide-y divide-base-300">
          {#each group.docs as doc (doc.href)}
            <li>
              <a
                class="block px-4 py-4 hover:bg-base-200/40 sm:px-5"
                href={resolveDocHref(doc.href)}
              >
                <h3 class="text-base font-semibold">{doc.title}</h3>
                <p class="mt-1 text-sm leading-6 text-base-content/70">
                  {doc.description}
                </p>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/each}
</div>
