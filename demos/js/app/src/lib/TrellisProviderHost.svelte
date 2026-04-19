<script>
  import { onMount } from "svelte";
  import { getContract } from "$lib/trellis";

  const providerModulePath = "../../../../js/packages/" + "trellis-svelte/src/components/TrellisProvider.svelte";

  let {
    children,
    loading,
    trellisUrl,
    loginPath,
  } = $props();

  let Provider = $state(null);
  let contract = $state(null);

  onMount(() => {
    void (async () => {
      const [mod, loadedContract] = await Promise.all([
        import(/* @vite-ignore */ providerModulePath),
        getContract(),
      ]);
      Provider = mod.default;
      contract = loadedContract;
    })();
  });
</script>

{#if Provider && contract}
  <Provider {trellisUrl} {contract} {loginPath}>
    {#if loading}
      {#snippet loading()}
        {@render loading()}
      {/snippet}
    {/if}

    {@render children()}
  </Provider>
{:else if loading}
  {@render loading()}
{/if}
