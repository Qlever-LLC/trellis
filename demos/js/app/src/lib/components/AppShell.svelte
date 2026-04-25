<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";
  import { getTrellis } from "$lib/trellis-context.ts";

  let { children }: { children: Snippet } = $props();

  const connection = getTrellis().connection;

  const currentPath = $derived(page.url.pathname);
  const status = $derived(connection.status);
  const signInHref = $derived(`${page.url.pathname}${page.url.search}`);
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
        href={resolve("/")}>Trellis demo</a
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
        <a class="btn btn-sm btn-outline" href={signInHref}>Sign in</a>
      {/if}
    </div>
  </header>

  <div class="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside
      class="card h-fit border border-base-300/70 bg-base-100/80 shadow-sm backdrop-blur lg:sticky lg:top-6"
    >
      <div class="card-body gap-4 p-4">
        <div class="space-y-1">
          <h1 class="card-title text-base">Feature Demos</h1>
        </div>

        <nav aria-label="Demo routes">
          <ul class="menu rounded-box bg-base-100 p-0">
            <li>
              <a
                href={resolve("/rpc")}
                class={{ "menu-active": currentPath === resolve("/rpc") }}
                aria-current={currentPath === resolve("/rpc")
                  ? "page"
                  : undefined}>RPC</a
              >
            </li>
            <li>
              <a
                href={resolve("/operation")}
                class={{ "menu-active": currentPath === resolve("/operation") }}
                aria-current={currentPath === resolve("/operation")
                  ? "page"
                  : undefined}>Operation</a
              >
            </li>
            <li>
              <a
                href={resolve("/transfer")}
                class={{ "menu-active": currentPath === resolve("/transfer") }}
                aria-current={currentPath === resolve("/transfer")
                  ? "page"
                  : undefined}>Transfer</a
              >
            </li>
            <li>
              <a
                href={resolve("/kv")}
                class={{ "menu-active": currentPath === resolve("/kv") }}
                aria-current={currentPath === resolve("/kv")
                  ? "page"
                  : undefined}>KV</a
              >
            </li>
            <li>
              <a
                href={resolve("/jobs")}
                class={{ "menu-active": currentPath === resolve("/jobs") }}
                aria-current={currentPath === resolve("/jobs")
                  ? "page"
                  : undefined}>Jobs</a
              >
            </li>
            <li>
              <a
                href={resolve("/state")}
                class={{ "menu-active": currentPath === resolve("/state") }}
                aria-current={currentPath === resolve("/state")
                  ? "page"
                  : undefined}>State</a
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
