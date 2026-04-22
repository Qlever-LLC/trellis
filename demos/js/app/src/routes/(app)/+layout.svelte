<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import { trellisUrl } from "$lib/trellis";
  import contract from "../../../contract.ts";

  let { children }: { children: Snippet } = $props();

  const demoLinks = [
    { href: "/rpc", label: "RPC" },
    { href: "/operation", label: "Operation" },
    { href: "/transfer", label: "Transfer" },
    { href: "/kv", label: "KV" },
    { href: "/jobs", label: "Jobs" },
    { href: "/state", label: "State" },
  ] as const;

  const currentPath = $derived(page.url.pathname);
</script>

<TrellisProvider {trellisUrl} {contract} loginPath="/login">
  {#snippet loading()}
    <section class="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div class="card w-full max-w-md bg-base-100 shadow-sm">
        <div class="card-body items-center text-center">
          <span class="loading loading-spinner loading-sm"></span>
          <h1 class="card-title text-lg">Loading demo</h1>
        </div>
      </div>
    </section>
  {/snippet}

  <section class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
    <header class="navbar rounded-box border border-base-300 bg-base-100 shadow-sm">
      <div class="navbar-start">
        <a class="btn btn-ghost text-base font-semibold" href="/">Trellis demo</a>
      </div>
      <div class="navbar-end">
        <a class="btn btn-sm btn-outline" href="/login?redirectTo=/rpc">Sign in</a>
      </div>
    </header>

    <div class="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside class="card bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div class="space-y-1">
            <h1 class="card-title text-lg">Demo routes</h1>
            <p class="text-sm text-base-content/70">Pick a route to learn a Trellis feature.</p>
          </div>

          <nav aria-label="Demo routes">
            <ul class="menu rounded-box bg-base-100 p-0">
              {#each demoLinks as link (link.href)}
                <li>
                  <a href={link.href} class={{ "menu-active": currentPath === link.href }} aria-current={currentPath === link.href ? "page" : undefined}>
                    {link.label}
                  </a>
                </li>
              {/each}
            </ul>
          </nav>
        </div>
      </aside>

      <main class="min-w-0">
        {@render children()}
      </main>
    </div>
  </section>
</TrellisProvider>
