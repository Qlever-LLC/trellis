<script lang="ts">
  import type { Snippet } from "svelte";
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import AppShell from "$lib/components/AppShell.svelte";
  import { trellisUrl } from "$lib/trellis";
  import { contract, setTrellis } from "$lib/trellis-context.ts";

  let { children }: { children: Snippet } = $props();
</script>

<TrellisProvider
  {contract}
  {setTrellis}
  {trellisUrl}
>
  {#snippet loading()}
    <section class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div class="card w-full max-w-md bg-base-100 shadow-sm">
        <div class="card-body items-center text-center">
          <span class="loading loading-spinner loading-sm"></span>
          <h1 class="card-title text-lg">Loading demo</h1>
        </div>
      </div>
    </section>
  {/snippet}

  <AppShell {children} />
</TrellisProvider>
