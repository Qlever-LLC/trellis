<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";
  import { getConnection } from "$lib/trellis-context.ts";

  let { children }: { children: Snippet } = $props();

  const connection = getConnection();

  const currentPath = $derived(page.url.pathname);
  const status = $derived(connection.status);
  const isConnected = $derived(status.phase === "connected");
</script>

<section
  class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
>
  <header
    class="navbar rounded-box border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur"
  >
    <div class="navbar-start">
      <a
        class="btn btn-ghost text-base font-semibold tracking-tight"
        href={resolve("/")}>Field Ops Console</a
      >
    </div>
    <div class="navbar-end gap-2">
      <span
        class={{
          badge: true,
          "badge-success": isConnected,
          "badge-warning": !isConnected,
          "badge-outline": true,
        }}
      >
        {status.phase}
      </span>
      {#if isConnected}
        <span
          class="btn btn-sm btn-disabled"
          aria-label="Signed in and connected">Signed in</span
        >
      {:else}
        <a class="btn btn-sm btn-outline" href={resolve("/dashboard")}>Sign in</a>
      {/if}
    </div>
  </header>

  <div class="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside
      class="card h-fit border border-base-300/70 bg-base-100/80 shadow-sm backdrop-blur lg:sticky lg:top-6"
    >
      <div class="card-body gap-4 p-4">
        <div class="space-y-1">
          <h1 class="card-title text-base">Console</h1>
        </div>

        <nav aria-label="Console routes">
          <ul class="menu rounded-box bg-base-100 p-0">
            <li>
              <a
                href={resolve("/dashboard")}
                class={{ "menu-active": currentPath === resolve("/dashboard") }}
                aria-current={currentPath === resolve("/dashboard")
                  ? "page"
                  : undefined}>Dashboard</a
              >
            </li>
            <li>
              <a
                href={resolve("/assignments")}
                class={{ "menu-active": currentPath === resolve("/assignments") }}
                aria-current={currentPath === resolve("/assignments")
                  ? "page"
                  : undefined}>Assignments</a
              >
            </li>
            <li>
              <a
                href={resolve("/sites")}
                class={{ "menu-active": currentPath === resolve("/sites") }}
                aria-current={currentPath === resolve("/sites")
                  ? "page"
                  : undefined}>Sites</a
              >
            </li>
            <li>
              <a
                href={resolve("/reports")}
                class={{ "menu-active": currentPath === resolve("/reports") }}
                aria-current={currentPath === resolve("/reports")
                  ? "page"
                  : undefined}>Reports</a
              >
            </li>
            <li>
              <a
                href={resolve("/evidence")}
                class={{ "menu-active": currentPath === resolve("/evidence") }}
                aria-current={currentPath === resolve("/evidence")
                  ? "page"
                  : undefined}>Evidence</a
              >
            </li>
            <li>
              <a
                href={resolve("/activity")}
                class={{ "menu-active": currentPath === resolve("/activity") }}
                aria-current={currentPath === resolve("/activity")
                  ? "page"
                  : undefined}>Activity</a
              >
            </li>
            <li>
              <a
                href={resolve("/workspace")}
                class={{ "menu-active": currentPath === resolve("/workspace") }}
                aria-current={currentPath === resolve("/workspace")
                  ? "page"
                  : undefined}>Workspace</a
              >
            </li>
          </ul>
        </nav>
      </div>
    </aside>

    <main class="min-w-0 pb-8">
      {@render children()}
    </main>
  </div>
</section>
