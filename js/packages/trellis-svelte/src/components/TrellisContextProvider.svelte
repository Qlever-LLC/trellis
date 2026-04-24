<script lang="ts" generics="TContract extends TrellisContractLike">
  import type { Snippet } from "svelte";
  import {
    provideConnectedTrellisContext,
    type ConnectedTrellisRuntime,
    type TrellisApp,
    type TrellisContractLike,
  } from "../context.svelte.ts";

  type Props = {
    app: TrellisApp<TContract>;
    trellis: ConnectedTrellisRuntime;
    children: Snippet;
  };

  const { app, trellis, children }: Props = $props();

  function installContext(): void {
    provideConnectedTrellisContext(app, trellis);
  }

  installContext();
</script>

{@render children()}
