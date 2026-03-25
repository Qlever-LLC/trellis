<script lang="ts">
  import { getNotifications } from "../notifications.svelte";

  const notifications = getNotifications();
</script>

{#if notifications.items.length > 0}
  <div class="toast toast-end toast-bottom z-50">
    {#each notifications.items as item (item.id)}
      <div
        class="alert shadow-lg max-w-sm"
        class:alert-success={item.tone === "success"}
        class:alert-error={item.tone === "error"}
        class:alert-info={item.tone === "info"}
        role="status"
        aria-live="polite"
      >
        <div>
          {#if item.title}
            <h3 class="font-semibold text-sm">{item.title}</h3>
          {/if}
          {#if item.message}
            <p class="text-xs">{item.message}</p>
          {/if}
        </div>
        <button class="btn btn-ghost btn-xs" onclick={() => notifications.dismiss(item.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}
