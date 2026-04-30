<script lang="ts">
  import { base } from "$app/paths";
  import { apiReferenceDocs, pendingRustdocCrates } from "$lib/docs";

  const typescriptDocs = apiReferenceDocs.filter((doc) =>
    doc.section === "API Reference"
  );
  const rustDocs = apiReferenceDocs.filter((doc) => doc.section === "Rustdoc");

  function resolveDocHref(href: string) {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return href;
    }

    if (!base) {
      return href;
    }

    return href === "/" ? `${base}/` : `${base}${href}`;
  }
</script>

<svelte:head>
  <title>API Reference | Trellis documentation</title>
  <meta
    name="description"
    content="Generated TypeScript API documentation and Rustdoc links for public Trellis crates."
  />
</svelte:head>

<div class="space-y-8">
  <section class="space-y-3">
    <p class="text-sm text-base-content/60">API Reference</p>
    <h1 class="text-3xl font-semibold sm:text-4xl">Trellis API Reference</h1>
    <p class="max-w-3xl text-sm leading-6 text-base-content/70">
      Use guides for task-oriented walkthroughs, design docs for architecture and
      protocol decisions, and generated API reference when you need exact
      language-level symbols.
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-base-content/50">
      TypeScript
    </h2>
    <div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
      <ul class="divide-y divide-base-300">
        {#each typescriptDocs as doc (doc.href)}
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

  <section class="space-y-3">
    <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-base-content/50">
      Rustdoc
    </h2>
    <div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
      <ul class="divide-y divide-base-300 sm:grid sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {#each rustDocs as doc (doc.href)}
          <li class="border-b border-base-300 sm:border-b-0">
            <a
              class="block h-full px-4 py-4 hover:bg-base-200/40 sm:px-5"
              href={resolveDocHref(doc.href)}
              rel="noreferrer"
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
    <p class="text-sm leading-6 text-base-content/60">
      Pending published Rustdoc links: {pendingRustdocCrates.join(", ")}.
    </p>
  </section>
</div>
