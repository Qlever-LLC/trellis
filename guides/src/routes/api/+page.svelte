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

<div class="docs-shell">
  <section class="space-y-3 border-b border-base-300 pb-5">
    <p class="docs-section-label">API Reference</p>
    <h1 class="text-3xl font-semibold sm:text-4xl">Trellis API Reference</h1>
    <p class="docs-metadata max-w-3xl">
      Use guides for task-oriented walkthroughs, design docs for architecture and
      protocol decisions, and generated API reference when you need exact
      language-level symbols.
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="docs-section-label">
      TypeScript
    </h2>
    <div class="docs-panel overflow-hidden">
      <ul class="divide-y divide-base-300">
        {#each typescriptDocs as doc (doc.href)}
          <li>
            <a
              class="docs-list-link px-4 py-4 sm:px-5"
              href={resolveDocHref(doc.href)}
            >
              <h3 class="docs-list-link-title">{doc.title}</h3>
              <p class="docs-list-link-description mt-1">
                {doc.description}
              </p>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="space-y-3">
    <h2 class="docs-section-label">
      Rustdoc
    </h2>
    <div class="docs-panel overflow-hidden">
      <ul class="divide-y divide-base-300 sm:grid sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {#each rustDocs as doc (doc.href)}
          <li class="border-b border-base-300 sm:border-b-0">
            <a
              class="docs-list-link h-full px-4 py-4 sm:px-5"
              href={resolveDocHref(doc.href)}
              rel="noreferrer"
            >
              <h3 class="docs-list-link-title">{doc.title}</h3>
              <p class="docs-list-link-description mt-1">
                {doc.description}
              </p>
            </a>
          </li>
        {/each}
      </ul>
    </div>
    <p class="docs-metadata">
      Pending published Rustdoc links: {pendingRustdocCrates.join(", ")}.
    </p>
  </section>
</div>
