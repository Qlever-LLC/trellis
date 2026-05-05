<script lang="ts">
  import { resolve } from "$app/paths";
  import DemoClientLogo from "$lib/components/DemoClientLogo.svelte";
</script>

<svelte:head>
  <title>Field Inspection Desk · Demo client for Trellis</title>
  <meta
    name="description"
    content="Field Inspection Desk is a Trellis-powered demo client for inspection queue, evidence, and closeout workflows."
  />
</svelte:head>

<section class="field-console min-h-screen px-4 py-9 sm:px-6 lg:px-8">
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-7">
    <div class="hero executive-panel overflow-hidden rounded-box">
      <div
        class="hero-content w-full p-6 text-left sm:p-8 lg:p-11"
      >
        <div class="min-w-0 space-y-7">
          <div class="space-y-4">
            <DemoClientLogo variant="landing" relationship="Powered by Trellis" />
            <p class="trellis-kicker">Browser demo · field inspection</p>
            <h1
              class="max-w-3xl break-words text-4xl font-black tracking-tight sm:text-5xl"
            >
              Sign in to Field Inspection Desk.
            </h1>
            <p class="max-w-2xl break-words text-[1.02rem] leading-8 text-base-content/72">
              Field Inspection Desk is a standalone demo client for an operator who reviews
              inspection assignments, verifies site context, attaches evidence, and closes out work.
            </p>
            <p class="max-w-2xl break-words text-sm leading-6 text-base-content/68">
              The demo connects to Trellis for RPC calls, long-running operations, live events,
              file transfers, and browser app state.
            </p>
          </div>

          <div class="flex flex-wrap gap-3">
            <a class="btn btn-accent" href={resolve("/inspection")}>
              Enter inspection desk
            </a>
            <a class="btn btn-outline" href={resolve("/evidence")}>
              Open evidence locker
            </a>
          </div>

          <div class="capability-note">
            <strong>Trellis primitives:</strong>
            RPC, operations, events, transfers, state
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
