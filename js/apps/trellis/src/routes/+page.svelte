<script lang="ts">
  import { createAuthState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { trellisApp } from "../contracts/trellis_app.ts";
  import { APP_CONFIG, getCanonicalLoopbackRedirectUrl } from "../lib/config";

  onMount(async () => {
    if (!browser) return;
    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }
    const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: trellisApp });
    await auth.init();
    if (auth.isAuthenticated) {
      await goto("/profile");
      return;
    }
    await goto("/login");
  });
</script>

<div class="flex min-h-screen items-center justify-center">
  <span class="loading loading-spinner loading-lg"></span>
</div>
