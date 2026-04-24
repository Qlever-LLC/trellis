<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";
  import { getConnection } from "$lib/trellis";

  let { children }: { children: Snippet } = $props();

  type DemoPath = "/rpc" | "/operation" | "/transfer" | "/kv" | "/jobs" | "/state";
  type SignInPath =
    | "/login?redirectTo=/rpc"
    | "/login?redirectTo=/operation"
    | "/login?redirectTo=/transfer"
    | "/login?redirectTo=/kv"
    | "/login?redirectTo=/jobs"
    | "/login?redirectTo=/state";

  function signInPath(path: DemoPath): SignInPath {
    switch (path) {
      case "/operation":
        return "/login?redirectTo=/operation";
      case "/transfer":
        return "/login?redirectTo=/transfer";
      case "/kv":
        return "/login?redirectTo=/kv";
      case "/jobs":
        return "/login?redirectTo=/jobs";
      case "/state":
        return "/login?redirectTo=/state";
      default:
        return "/login?redirectTo=/rpc";
    }
  }

  const connection = getConnection();
  const demoLinks = [
    { href: "/rpc", resolvedHref: resolve("/rpc"), label: "RPC" },
    { href: "/operation", resolvedHref: resolve("/operation"), label: "Operation" },
    { href: "/transfer", resolvedHref: resolve("/transfer"), label: "Transfer" },
    { href: "/kv", resolvedHref: resolve("/kv"), label: "KV" },
    { href: "/jobs", resolvedHref: resolve("/jobs"), label: "Jobs" },
    { href: "/state", resolvedHref: resolve("/state"), label: "State" },
  ] as const;

  const currentPath = $derived(page.url.pathname);
  const status = $derived(connection.status);
  const currentDemoPath = $derived(demoLinks.find((link) => currentPath === link.resolvedHref)?.href ?? "/rpc");
  const signInHref = $derived.by((): SignInPath => signInPath(currentDemoPath));
  const isConnected = $derived(status.phase === "connected");
</script>

<section class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
  <header class="navbar rounded-box border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="navbar-start">
      <a class="btn btn-ghost text-base font-semibold tracking-tight" href={resolve("/")}>Trellis demo</a>
    </div>
    <div class="navbar-end gap-2">
      <span class={{ badge: true, "badge-success": isConnected, "badge-warning": !isConnected, "badge-outline": true }}>
        {status.phase}
      </span>
      {#if isConnected}
        <span class="btn btn-sm btn-disabled" aria-label="Signed in and connected">Signed in</span>
      {:else}
        <a class="btn btn-sm btn-outline" href={resolve(signInHref)}>Sign in</a>
      {/if}
    </div>
  </header>

  <div class="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside class="card h-fit border border-base-300/70 bg-base-100/80 shadow-sm backdrop-blur lg:sticky lg:top-6">
      <div class="card-body gap-4 p-4">
        <div class="space-y-1">
          <h1 class="card-title text-base">Demo routes</h1>
          <p class="text-sm text-base-content/70">Pick a route to learn a Trellis feature.</p>
        </div>

        <nav aria-label="Demo routes">
          <ul class="menu rounded-box bg-base-100 p-0">
            {#each demoLinks as link (link.href)}
              <li>
                <a href={resolve(link.href)} class={{ "menu-active": currentPath === link.resolvedHref }} aria-current={currentPath === link.resolvedHref ? "page" : undefined}>
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
      </div>
    </aside>

    <main class="min-w-0 pb-8">
      {@render children()}
    </main>
  </div>
</section>
