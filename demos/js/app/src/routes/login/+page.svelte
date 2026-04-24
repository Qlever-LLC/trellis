<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { auth, trellisUrl } from "$lib/trellis";

  let authError = $state<string | null>(null);
  let ready = $state(false);
  let signingIn = $state(false);

  type DemoPath = "/rpc" | "/operation" | "/transfer" | "/kv" | "/jobs" | "/state";

  function demoPath(value: string | null): DemoPath {
    switch (value) {
      case "/operation":
      case "/transfer":
      case "/kv":
      case "/jobs":
      case "/state":
        return value;
      default:
        return "/rpc";
    }
  }

  const targetPath = $derived.by((): DemoPath => demoPath(page.url.searchParams.get("redirectTo")));

  async function beginSignIn(): Promise<void> {
    signingIn = true;
    authError = null;

    try {
      await auth.signIn({
        redirectTo: new URL(targetPath, page.url).toString(),
      });
    } catch (error) {
      authError = error instanceof Error ? error.message : String(error);
      signingIn = false;
    }
  }

  onMount(() => {
    authError = page.url.searchParams.get("authError");

    void (async () => {
      try {
        await auth.init();
        const bindResult = await auth.handleCallback(page.url.toString());
        if (bindResult?.status === "bound") {
          await goto(resolve(targetPath));
          return;
        }
        if (bindResult) {
          authError = bindResult.status === "insufficient_capabilities"
            ? `Missing capabilities: ${bindResult.missingCapabilities.join(", ")}`
            : bindResult.status === "approval_denied"
            ? "Portal access was denied."
            : bindResult.status === "approval_required"
            ? "Approval is still pending."
            : authError;
        }
      } catch (error) {
        authError = error instanceof Error ? error.message : String(error);
      } finally {
        ready = true;
      }
    })();
  });
</script>

<svelte:head>
  <title>Sign in · Trellis Demo App</title>
</svelte:head>

<section class="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8 sm:px-6 lg:px-8">
  <div class="card w-full bg-base-100 shadow-sm">
    <div class="card-body gap-5">
      <div class="space-y-2">
        <h1 class="card-title text-2xl">Sign in to the demo app</h1>
        <p class="text-sm leading-6 text-base-content/75 sm:text-base">
          Start a Trellis sign-in flow, then return to the route you want to test.
        </p>
      </div>

      <dl class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-box border border-base-300 bg-base-200 p-4">
          <dt class="text-sm font-medium text-base-content/70">Target route</dt>
          <dd class="mt-2 break-all font-mono text-sm">{targetPath}</dd>
        </div>
        <div class="rounded-box border border-base-300 bg-base-200 p-4">
          <dt class="text-sm font-medium text-base-content/70">Trellis URL</dt>
          <dd class="mt-2 break-all font-mono text-sm">{trellisUrl}</dd>
        </div>
      </dl>

      {#if authError}
        <div class="alert alert-error">
          <span>{authError}</span>
        </div>
      {/if}

      {#if ready}
        <div class="flex flex-wrap gap-3">
          <button class="btn btn-primary" onclick={beginSignIn} disabled={signingIn}>
            {signingIn ? "Redirecting…" : "Continue to sign in"}
          </button>
          <a class="btn btn-outline" href={resolve("/")}>Back to home</a>
        </div>
      {:else}
        <div class="flex items-center gap-3 text-sm text-base-content/70">
          <span class="loading loading-spinner loading-sm"></span>
          <span>Checking session</span>
        </div>
      {/if}
    </div>
  </div>
</section>
