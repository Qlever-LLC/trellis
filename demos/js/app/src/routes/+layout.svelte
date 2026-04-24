<script lang="ts">
  import "../app.css";

  let { children }: import("./$types").LayoutProps = $props();
</script>

<div class="min-h-screen bg-base-200 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_34rem)] text-base-content">
  {@render children()}
</div>
