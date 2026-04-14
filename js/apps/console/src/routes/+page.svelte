<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { getCanonicalLoopbackRedirectUrl, getSelectedAuthUrl } from "../lib/config";
  import { auth } from "../lib/trellis";

  onMount(async () => {
    if (!browser) return;
    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }
    const selectedAuthUrl = getSelectedAuthUrl(window.location);
    if (selectedAuthUrl) {
      auth.setAuthUrl(selectedAuthUrl);
    }
    await auth.init();
    if (auth.isAuthenticated) {
      await goto(resolve("/profile"));
      return;
    }
    await goto(resolve("/login"));
  });
</script>

<div class="flex min-h-screen items-center justify-center">
  <span class="loading loading-spinner loading-lg"></span>
</div>
