<script lang="ts">
  type IconName =
    | "activity"
    | "alert"
    | "arrowRight"
    | "bell"
    | "box"
    | "chevronDown"
    | "clipboard"
    | "cpu"
    | "database"
    | "grid"
    | "key"
    | "menu"
    | "more"
    | "phone"
    | "refresh"
    | "search"
    | "server"
    | "settings"
    | "shield"
    | "sun"
    | "users"
    | "globe";

  type Props = {
    name: IconName | string;
    size?: number;
    class?: string;
  };

  let { name, size = 18, class: className = "" }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  {#if name === "search"}
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  {:else if name === "sun"}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  {:else if name === "bell"}
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" />
  {:else if name === "menu"}
    <path d="M4 6h16M4 12h16M4 18h16" />
  {:else if name === "chevronDown"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "refresh"}
    <path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v6h-6" />
  {:else if name === "box"}
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
  {:else if name === "alert"}
    <path d="M10.3 3.8 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" />
  {:else if name === "activity"}
    <path d="M3 12h4l2-7 4 14 2-7h6" />
  {:else if name === "users"}
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  {:else if name === "shield"}
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  {:else if name === "server"}
    <rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" />
  {:else if name === "settings"}
    <circle cx="12" cy="12" r="3" /><path d="M19 15.5a2 2 0 0 0 .4 2.2l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V22a2 2 0 0 1-4 0v-.1A2 2 0 0 0 8 20.1a2 2 0 0 0-2.2.4l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a2 2 0 0 0 .4-2.2 2 2 0 0 0-1.8-1.2H2a2 2 0 0 1 0-4h.1A2 2 0 0 0 3.9 9a2 2 0 0 0-.4-2.2l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A2 2 0 0 0 8.5 4 2 2 0 0 0 9.7 2.2V2a2 2 0 0 1 4 0v.1A2 2 0 0 0 15 3.9a2 2 0 0 0 2.2-.4l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.1a2 2 0 0 1 0 4h-.1a2 2 0 0 0-1.8 1.8Z" />
  {:else if name === "database"}
    <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  {:else if name === "cpu"}
    <rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  {:else if name === "clipboard"}
    <path d="M9 4h6a2 2 0 0 1 2 2v1H7V6a2 2 0 0 1 2-2Z" /><rect x="5" y="5" width="14" height="17" rx="2" /><path d="M9 12h6M9 16h4" />
  {:else if name === "key"}
    <circle cx="7.5" cy="15.5" r="4.5" /><path d="M11 12 21 2M16 7l2 2M14 9l2 2" />
  {:else if name === "phone"}
    <rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />
  {:else if name === "globe"}
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
  {:else if name === "grid"}
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  {:else if name === "more"}
    <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
  {:else if name === "arrowRight"}
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  {:else}
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
  {/if}
</svg>
