<script lang="ts">
  import { createAuthState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { activityApp } from "../../contracts/activity_app.ts";
  import { APP_CONFIG } from "../../lib/config";
  import { errorMessage } from "../../lib/format";

  type CallbackResult =
    | { status: "bound" }
    | { status: "approval_required" | "approval_denied"; approval: unknown }
    | { status: "insufficient_capabilities"; missingCapabilities: string[] };

  const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: activityApp });

  let status = $state("Finalizing sign-in...");
  let authError = $state<string | null>(null);

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/activity";
  }

  function authErrorFromFragment(url: string): string | null {
    const parsed = new URL(url);
    const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    return new URLSearchParams(fragment).get("authError");
  }

  onMount(async () => {
    if (!browser) return;

    try {
      await auth.init();
      const result = await auth.handleCallback(window.location.href);
      auth.cleanupCallbackUrl();

      if (!result) {
        const flowError = authErrorFromFragment(window.location.href);
        if (flowError === "approval_denied") {
          status = "Access was not delegated to Activity Console.";
          return;
        }
        throw new Error("Missing auth token");
      }

      if (result.status === "bound") {
        status = "Session bound. Opening the activity feed...";
        await goto(targetPath());
        return;
      }

      if (result.status === "insufficient_capabilities") {
        authError = `Missing capabilities: ${result.missingCapabilities.join(", ")}`;
        status = "Your account does not currently have the required activity access.";
        return;
      }

      status = "Approval must be completed in the Trellis auth flow before this app can bind a session.";
    } catch (nextError) {
      authError = errorMessage(nextError);
      status = "The callback could not be completed.";
    }
  });
</script>

<svelte:head>
  <title>Authorizing · Activity Console</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4 py-10" data-theme="activity">
  <section class="card w-full max-w-xl border border-base-300/70 paper-panel shadow-2xl">
    <div class="card-body gap-6 p-6 md:p-8">
      <div class="space-y-2 text-center">
        <div class="badge badge-outline badge-primary mx-auto">OAuth callback</div>
        <h1 class="display text-3xl text-base-content">{status}</h1>
        <p class="text-sm leading-6 text-base-content/70">
          Trellis is restoring the browser binding token, reconnecting NATS, and preparing Activity RPC access.
        </p>
      </div>

      {#if authError}
        <div class="alert alert-error">
          <span>{authError}</span>
        </div>

        <div class="card border border-base-300/60 bg-base-100/55 shadow-sm">
          <div class="card-body gap-4">
            <p class="text-sm text-base-content/70">The operator session could not be restored from the returned auth token.</p>
            <div>
              <a class="btn btn-ghost" href="/login">Return to sign in</a>
            </div>
          </div>
        </div>
      {:else}
        <div class="card border border-base-300/60 bg-base-100/55 shadow-sm">
          <div class="card-body items-center gap-3 text-center">
            <span class="loading loading-ring loading-lg text-primary"></span>
            <p class="text-sm text-base-content/70">Binding browser state and reopening the live activity feed.</p>
          </div>
        </div>
      {/if}
    </div>
  </section>
</div>
