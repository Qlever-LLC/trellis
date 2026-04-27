<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { getCanonicalLoopbackRedirectUrl, getSelectedAuthUrl } from "../lib/config";
  import { auth } from "../lib/auth";

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
    await goto(resolve("/login"));
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
  <div class="card trellis-card w-full max-w-sm border border-base-300 bg-base-100 shadow-none">
    <div class="card-body items-center gap-3 text-center">
      <h1 class="text-lg font-semibold">Loading console</h1>
      <span class="loading loading-spinner loading-md"></span>
    </div>
  </div>
</div>
