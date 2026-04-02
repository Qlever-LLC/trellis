<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";

  let { children }: { children: Snippet } = $props();

  const pathname = $derived(normalizePath(stripBasePath(page.url.pathname)));
  const overviewActive = $derived(pathname === "/");
  const guidesActive = $derived(pathname === "/docs" || pathname.startsWith("/docs/"));
  const designActive = $derived(pathname === "/design" || pathname.startsWith("/design/"));

  function normalizePath(path: string) {
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }

  function stripBasePath(pathname: string) {
    if (!base) {
      return pathname;
    }

    if (pathname === base) {
      return "/";
    }

    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  }
</script>

<div class="min-h-screen bg-base-100 text-base-content">
  <header class="border-b border-base-300 bg-base-100">
    <div
      class="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6"
    >
      <a href={resolve("/")} class="text-sm font-semibold">Trellis documentation</a>

      <div class="flex items-center gap-4 text-sm">
        <nav class="flex items-center gap-4" aria-label="Primary">
          <a
            class={[
              overviewActive
                ? "font-medium text-base-content"
                : "text-base-content/70",
              "hover:text-base-content",
            ]}
            href={resolve("/")}>Overview</a
          >
          <a
            class={[
              guidesActive
                ? "font-medium text-base-content"
                : "text-base-content/70",
              "hover:text-base-content",
            ]}
            href={resolve("/docs")}>Guides</a
          >
          <a
            class={[
              designActive
                ? "font-medium text-base-content"
                : "text-base-content/70",
              "hover:text-base-content",
            ]}
            href={resolve("/design")}>Design</a
          >
        </nav>
      </div>
    </div>
  </header>

  <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
    {@render children()}
  </main>
</div>
