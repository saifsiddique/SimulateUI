<script lang="ts">
  // ④ Run · Results (context.md §7.MU step U7, M6, M6.5, M7): three columns.
  //
  //   Compute | Postprocessing        | Results viewer
  //   Run     | Output (and earlier runs) |
  //
  // Compute shows what the chosen method will cost; Run starts it and lists what is ready;
  // Postprocessing is the detector (pixel size, smoothing, dose, noise) applied to the selected
  // run afterwards; Output follows the job and lists the earlier ones; the Results viewer gets the
  // room that is left and switches between the native and the processed result.
  import type { TabId } from '../core/workflow';
  import ComputeCard from './ComputeCard.svelte';
  import OutputCard from './OutputCard.svelte';
  import PostprocessingCard from './PostprocessingCard.svelte';
  import ResultsViewerCard from './ResultsViewerCard.svelte';
  import RunCard from './RunCard.svelte';

  let {
    onGo,
    name = '',
    spaceGroup = '',
  }: {
    onGo: (tab: TabId) => void;
    name?: string;
    spaceGroup?: string;
  } = $props();
</script>

<div class="run-step" data-testid="run-step">
  <div class="col">
    <ComputeCard />
    <RunCard {onGo} {name} {spaceGroup} />
  </div>
  <div class="col">
    <PostprocessingCard />
    <OutputCard />
  </div>
  <ResultsViewerCard />
</div>

<style>
  .run-step {
    display: grid;
    grid-template-columns: minmax(17rem, 28rem) minmax(17rem, 28rem) minmax(0, 1fr);
    gap: 0.8rem;
    align-items: start;
    min-width: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }
  @media (max-width: 75rem) {
    .run-step {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
