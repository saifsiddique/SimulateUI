<script lang="ts">
  // A view panel (context.md §7.MU kit): the .phead strip (name, then an Export menu or other
  // title-side controls, then Reset/zoom tools on the right) over a stage. `square` keeps the stage
  // square, as the two panels of strFac_app's electron-diffraction tab.
  import type { Snippet } from 'svelte';

  let {
    title,
    square = false,
    titleExtra,
    tools,
    children,
    testid = '',
  }: {
    title: string;
    square?: boolean;
    /** After the name: the Export ▾ menu, a mode switch. */
    titleExtra?: Snippet;
    /** Right side: Reset, zoom. */
    tools?: Snippet;
    children: Snippet;
    testid?: string;
  } = $props();
</script>

<section class="vc card" aria-label={title} data-testid={testid || undefined}>
  <div class="phead">
    <span class="phead-title">
      <span>{title}</span>
      {#if titleExtra}{@render titleExtra()}{/if}
    </span>
    {#if tools}<span class="phead-tools">{@render tools()}</span>{/if}
  </div>
  <div class="stage" class:square>
    {@render children()}
  </div>
</section>

<style>
  .vc {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .stage {
    position: relative;
    min-height: 0;
    flex: 1;
  }
  .stage.square {
    aspect-ratio: 1;
    flex: none;
  }
</style>
