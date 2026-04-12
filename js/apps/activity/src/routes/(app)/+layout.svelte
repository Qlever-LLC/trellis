<script lang="ts">
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Snippet } from "svelte";
  import AppFrame from "../../lib/components/AppFrame.svelte";
  import { APP_CONFIG } from "../../lib/config.ts";
  import { activityApp } from "../../../contracts/activity_app.ts";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();

  function handleAuthFailed(): void {
    window.location.href = `/login?redirectTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
</script>

<TrellisProvider
  trellisUrl={APP_CONFIG.authUrl}
  contract={activityApp}
  loginPath="/login"
  onAuthFailed={handleAuthFailed}
>
  {#snippet loading()}
    <div class="flex min-h-screen items-center justify-center px-4 py-10" data-theme="activity">
      <div class="card w-full max-w-xl border border-base-300/70 paper-panel shadow-2xl">
        <div class="card-body gap-4 text-center">
          <div class="badge badge-outline badge-primary mx-auto">Realtime bootstrap</div>
          <h1 class="display text-3xl text-base-content">Connecting the operator feed</h1>
          <p class="text-sm leading-6 text-base-content/70">
            Opening the browser session, authenticating Trellis RPCs, and attaching to the Activity projection.
          </p>
          <div class="flex items-center justify-center gap-3 text-sm text-base-content/60">
            <span class="loading loading-dots loading-md text-primary"></span>
            <span>Preparing the audit stream</span>
          </div>
        </div>
      </div>
    </div>
  {/snippet}

  <AppFrame>
    {@render children()}
  </AppFrame>
</TrellisProvider>
