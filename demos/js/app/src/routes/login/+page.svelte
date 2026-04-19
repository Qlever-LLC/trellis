<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { auth, trellisUrl } from "$lib/trellis";

  let authError = $state<string | null>(null);
  let ready = $state(false);
  let signingIn = $state(false);

  const targetPath = $derived(page.url.searchParams.get("redirectTo") ?? resolve("/rpc"));

  async function beginSignIn(): Promise<void> {
    signingIn = true;
    authError = null;

    try {
      await auth.signIn({
        redirectTo: new URL(targetPath, page.url).toString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("Redirecting")) {
        authError = message;
      }
      signingIn = false;
    }
  }

  onMount(() => {
    if (!browser) return;

    authError = page.url.searchParams.get("authError");

    void (async () => {
      try {
        await auth.init();
        if (auth.isAuthenticated) {
          await goto(targetPath);
          return;
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
  <title>Sign in · Field inspection demo</title>
</svelte:head>

<section class="page-shell login-shell">
  <div class="panel panel-strong stack login-card">
    <p class="eyebrow">Sign in</p>
    <h1>Authenticate this browser app</h1>
    <p class="page-summary">This demo uses a fixed Trellis instance and returns you to the route you picked after approval completes.</p>

    <dl class="meta-grid">
      <div>
        <dt>Instance</dt>
        <dd class="code">{trellisUrl}</dd>
      </div>
      <div>
        <dt>Next route</dt>
        <dd class="code">{targetPath}</dd>
      </div>
    </dl>

    {#if authError}
      <div class="error-banner">{authError}</div>
    {/if}

    {#if ready}
      <div class="button-row">
        <button class="button" onclick={beginSignIn} disabled={signingIn}>
          {signingIn ? "Redirecting…" : "Continue to Trellis sign in"}
        </button>
        <a class="ghost-button" href="/">Back to overview</a>
      </div>
    {:else}
      <p class="status-line">Checking for an existing authenticated session…</p>
    {/if}
  </div>
</section>

<style>
  .login-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
  }

  .login-card {
    width: min(34rem, 100%);
  }
</style>
