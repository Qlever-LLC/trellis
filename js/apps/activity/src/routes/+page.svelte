<script lang="ts">
  import { createAuthState } from "@trellis/svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { activityApp } from "../contracts/activity_app.ts";
  import { APP_CONFIG } from "../lib/config";

  onMount(async () => {
    if (!browser) return;
    const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: activityApp });
    await auth.init();
    if (auth.isAuthenticated) {
      await goto("/activity");
      return;
    }
    await goto("/login");
  });
</script>

<div class="flex min-h-screen items-center justify-center px-4 py-10" data-theme="activity">
  <div class="card w-full max-w-xl border border-base-300/70 paper-panel shadow-2xl">
    <div class="card-body gap-4 text-center">
      <div class="badge badge-outline badge-primary mx-auto">Realtime bootstrap</div>
      <h1 class="display text-3xl text-base-content">Opening the activity console</h1>
      <p class="text-sm leading-7 text-base-content/70">
        Checking your browser session, then reconnecting to Auth and the Activity projection.
      </p>
      <div class="flex items-center justify-center gap-3 text-sm text-base-content/60">
        <span class="loading loading-ring loading-sm"></span>
        <span>Preparing the operator feed</span>
      </div>
    </div>
  </div>
</div>
