<script lang="ts">
  import { base } from "$app/paths";
  import { guideDocsBySection } from "$lib/docs";

  const groups = guideDocsBySection();

  function resolveDocHref(href: string) {
    if (!base) {
      return href;
    }

    return href === "/" ? `${base}/` : `${base}${href}`;
  }
</script>

<div class="docs-shell">
  <section class="space-y-3 border-b border-base-300 pb-5">
    <p class="docs-section-label">Guides</p>
    <h1 class="text-3xl font-semibold sm:text-4xl">Trellis Guides</h1>
    <p class="docs-metadata max-w-3xl">
      Practical setup, getting started, features, advanced, administration, and contributor guidance for working with Trellis.
    </p>
  </section>

  {#each groups as group (group.section)}
    <section class="space-y-3">
      <h2 class="docs-section-label">
        {group.section}
      </h2>
      <div class="docs-panel overflow-hidden">
        <ul class="divide-y divide-base-300">
          {#each group.docs as doc (doc.href)}
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
  {/each}
</div>
