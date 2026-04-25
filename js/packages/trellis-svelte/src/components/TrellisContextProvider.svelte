<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    provideConnectedTrellisContext,
    type TrellisAppOwner,
    type TrellisContextClient,
  } from "../context.svelte.ts";

  type Props = {
    app?: TrellisAppOwner;
    setTrellis?: (trellis: TrellisContextClient) => TrellisContextClient;
    trellis: TrellisContextClient;
    children: Snippet;
  };

  const { app, setTrellis, trellis, children }: Props = $props();

  function installContext(): void {
    if (setTrellis) {
      setTrellis(trellis);
      return;
    }
    if (app) {
      provideConnectedTrellisContext(app, trellis);
      return;
    }
    throw new TypeError("Expected either app or setTrellis");
  }

  installContext();
</script>

{@render children()}
