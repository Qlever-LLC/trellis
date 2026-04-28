<script lang="ts">
  import "../app.css";

  let { children }: import("./$types").LayoutProps = $props();
</script>

<div class="min-h-screen bg-base-200 text-base-content">
  {@render children()}
</div>
