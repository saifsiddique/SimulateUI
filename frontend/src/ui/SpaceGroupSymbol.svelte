<script lang="ts">
  // A Hermann-Mauguin symbol set properly: italic letters, screw subscripts, rotoinversion bars.
  import { hmTokens } from '../core/symmetry/hmFormat';

  let { symbol }: { symbol: string } = $props();
  const tokens = $derived(hmTokens(symbol));
</script>

<span class="hm"
  >{#each tokens as t, i (i)}{#if t.bar}<span class="bar">{t.text}</span>{:else if t.italic}<i
        >{t.text}</i
      >{:else}{t.text}{/if}{#if t.sub}<sub>{t.sub}</sub>{/if}{/each}</span
>

<style>
  .hm {
    font-family: 'Times New Roman', Times, serif;
    font-size: 1.1em;
    white-space: nowrap;
  }
  .bar {
    text-decoration: overline;
  }
  sub {
    font-size: 0.7em;
  }
</style>
