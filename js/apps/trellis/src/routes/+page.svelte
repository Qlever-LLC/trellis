<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { getCanonicalLoopbackRedirectUrl, getSelectedAuthUrl } from "../lib/config";
  import { app } from "../lib/trellis";

  onMount(async () => {
    if (!browser) return;
    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }
    const selectedAuthUrl = getSelectedAuthUrl(window.location);
    if (selectedAuthUrl) {
      app.auth.setAuthUrl(selectedAuthUrl);
    }
    await app.auth.init();
    if (app.auth.isAuthenticated) {
      await goto("/profile");
      return;
    }
    await goto("/login");
  });
</script>

<div class="flex min-h-screen items-center justify-center">
  <span class="loading loading-spinner loading-lg"></span>
</div>
