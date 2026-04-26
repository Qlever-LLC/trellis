<script lang="ts">
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import AppShell from "$lib/components/AppShell.svelte";
  import { trellisApp } from "$lib/trellis";

  let { children }: { children: Snippet } = $props();
</script>

<TrellisProvider {trellisApp}>
  {#snippet loading()}
    <section
      class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8"
    >
      <div class="card w-full max-w-md bg-base-100 shadow-sm">
        <div class="card-body items-center text-center">
          <span class="loading loading-spinner loading-sm"></span>
          <h1 class="card-title text-lg">Loading demo</h1>
        </div>
      </div>
    </section>
  {/snippet}

  {#snippet error(cause)}
    <section
      class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8"
    >
      <div
        class="card w-full max-w-xl border border-error/30 bg-base-100 shadow-sm"
      >
        <div class="card-body gap-4">
          <div class="space-y-1">
            <h1 class="card-title text-lg text-error">Could not connect</h1>
            <p class="text-sm text-base-content/70">
              The Field Inspection Desk could not finish connecting to Trellis.
            </p>
          </div>

          <pre
            class="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs">{cause instanceof
            Error
              ? cause.message
              : String(cause)}</pre>

          <a class="btn btn-outline btn-sm w-fit" href={resolve("/dashboard")}
            >Retry</a
          >
        </div>
      </div>
    </section>
  {/snippet}

  <AppShell {children} />
</TrellisProvider>
