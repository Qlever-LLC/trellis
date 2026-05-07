<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import PortalBrand from "$lib/components/PortalBrand.svelte";

  onMount(() => {
    if (!browser) return;
    void goto(`/_trellis/portal/users/login${window.location.search}`);
  });
</script>

<svelte:head>
  <title>Portal · Trellis</title>
</svelte:head>

<div
  class="portal-shell flex min-h-screen flex-col items-center justify-center gap-7 px-4 py-10"
  data-theme="portal"
>
  <div class="portal-card card w-full max-w-md border border-base-300">
    <div class="card-body items-center gap-4 p-7 text-center">
      <PortalBrand subtitle="Login portal" />
      <span class="loading loading-ring loading-lg"></span>
      <div>
        <p class="text-sm font-medium text-base-content">Preparing sign-in</p>
        <p class="portal-copy mt-1 text-xs">Checking the request context.</p>
      </div>
    </div>
  </div>
</div>
