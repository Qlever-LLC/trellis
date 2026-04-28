<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  onMount(() => {
    if (!browser) return;
    void goto(`/_trellis/portal/users/login${window.location.search}`);
  });
</script>

<svelte:head>
  <title>Portal · Trellis</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10" data-theme="portal">
  <div class="flex items-center gap-2">
    <span class="inline-block h-2 w-2 rounded-full bg-primary"></span>
    <span class="text-sm font-semibold text-base-content/55">Trellis</span>
  </div>
  <div class="card w-full max-w-sm border border-base-300 bg-base-100 shadow-md">
    <div class="card-body items-center gap-4 p-6 text-center">
      <span class="loading loading-ring loading-md"></span>
      <p class="text-sm text-base-content/60">Preparing sign-in</p>
    </div>
  </div>
</div>
