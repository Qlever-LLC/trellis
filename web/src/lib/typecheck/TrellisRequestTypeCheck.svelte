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

{#await trellis.authSessionsMe({}).orThrow() then me}
  <span>{displayParticipantKind(me.session.participantKind)}</span>
  <span>{displayDeviceId(me.instanceId ?? undefined)}</span>
{/await}
