<script lang="ts">
  import { resolve } from "$app/paths";
  import { docs } from "$lib/docs";
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
    <h1 class="text-3xl font-semibold sm:text-4xl">Trellis Guides</h1>
  </section>

  <section class="space-y-3">
    <div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
      <ul class="divide-y divide-base-300">
        {#each docs as doc (doc.href)}
          <li>
            <a
              class="block px-4 py-4 hover:bg-base-200/40 sm:px-5"
              href={resolve(doc.href)}
            >
              <p
                class="text-xs font-medium uppercase tracking-[0.14em] text-base-content/50"
              >
                {doc.eyebrow}
              </p>
              <h3 class="mt-1 text-base font-semibold">{doc.title}</h3>
              <p class="mt-1 text-sm leading-6 text-base-content/70">
                {doc.description}
              </p>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </section>
</div>
