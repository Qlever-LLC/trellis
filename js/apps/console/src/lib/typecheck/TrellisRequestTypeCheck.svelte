<script lang="ts">
  import type { TrellisConsoleClient } from "../trellis-context.svelte.ts";

  let { trellis }: { trellis: TrellisConsoleClient } = $props();

  function displayParticipantKind(
    kind: "app" | "agent" | "device" | "service",
  ): string {
    return kind;
  }

  function displayDeviceId(deviceId: string | undefined): string {
    return deviceId ?? "no-device";
  }
</script>

{#await trellis.request("Auth.Me", {}).orThrow() then me}
  <span>{displayParticipantKind(me.participantKind)}</span>
  <span>{displayDeviceId(me.device?.deviceId)}</span>
{/await}
