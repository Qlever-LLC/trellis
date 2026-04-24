<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    provideConnectedTrellisContext,
    type TrellisAppOwner,
    type TrellisContextClient,
  } from "../context.svelte.ts";

  type Props = {
    app: TrellisAppOwner;
    trellis: TrellisContextClient;
    children: Snippet;
  };

  const { app, trellis, children }: Props = $props();

  function installContext(): void {
    provideConnectedTrellisContext(app, trellis);
  }

  installContext();
</script>

{@render children()}
