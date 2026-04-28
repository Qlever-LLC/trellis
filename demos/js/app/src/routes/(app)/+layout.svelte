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
      class="field-console mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8"
    >
      <div class="page-sheet w-full max-w-md rounded-box p-7">
        <div class="flex flex-col items-center gap-4 text-center">
          <span class="loading loading-spinner loading-sm"></span>
          <p class="trellis-kicker">Field Inspection Desk</p>
          <h1 class="text-lg font-black tracking-tight">Connecting to Trellis server</h1>
          <p class="max-w-sm text-sm leading-6 text-base-content/65">
            Preparing the demo client session and Trellis-backed workflow data.
          </p>
        </div>
      </div>
    </section>
  {/snippet}

  {#snippet error(cause)}
    <section
      class="field-console mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8"
    >
      <div
        class="page-sheet w-full max-w-xl rounded-box p-7"
      >
        <div class="flex flex-col gap-5">
          <div class="space-y-2">
            <p class="trellis-kicker">Connection status</p>
            <h1 class="text-lg font-black tracking-tight text-error">Could not connect</h1>
            <p class="text-sm text-base-content/70">
              The Field Inspection Desk demo client could not finish connecting to the Trellis server.
            </p>
          </div>

          <pre
            class="overflow-x-auto whitespace-pre-wrap border-y border-base-300/80 bg-base-200/55 px-1 py-3 text-xs">{cause instanceof
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
