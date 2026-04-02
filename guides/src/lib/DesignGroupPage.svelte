<script lang="ts">
  
  import { error } from "@sveltejs/kit";
import { base } from "$app/paths";
  import { getDesignGroup, getDocsForDesignGroup } from "$lib/docs";

  interface Props {
    slug: string;
  }

  let { slug }: Props = $props();

  const docs = $derived.by(() => {
    if (!getDesignGroup(slug)) {
      throw error(404, "Design group not found");
    }

    return getDocsForDesignGroup(slug);
  });

  function resolveDocHref(href: string) {
    if (!base) {
      return href;
    }

    return href === "/" ? `${base}/` : `${base}${href}`;
  }
</script>

<div class="not-prose space-y-4">
  <div class="grid gap-4 sm:grid-cols-2">
    {#each docs as doc (doc.href)}
      <a
        class="rounded-box border border-base-300 bg-base-100 p-4 transition-colors hover:bg-base-200/40"
        href={resolveDocHref(doc.href)}
      >
        <h2 class="text-base font-semibold text-base-content">{doc.title}</h2>
        <p class="mt-2 text-sm leading-6 text-base-content/70">
          {doc.description}
        </p>
      </a>
    {:else}
      <div class="rounded-box border border-dashed border-base-300 bg-base-100 p-4 text-sm text-base-content/60 sm:col-span-2">
        No design docs are available in this group yet.
      </div>
    {/each}
  </div>
</div>
