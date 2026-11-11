// The test hook the viewer puts on `window` (src/ui/Viewer.svelte), shared by all e2e specs.
interface CrystalLensHook {
  atomScreen(i: number): { x: number; y: number };
  stats(): { frames: number; renders: number };
  model(): { count: number; bonds: Uint32Array; elements: string[]; species: Uint16Array };
  pickAt(x: number, y: number): number | null;
  selection(): number[];
  viewState(): { direction: number[]; up: number[]; visibleHeight: number };
  settings(): {
    hiddenAtoms: unknown[];
    appearance: { elements: Record<string, { visible?: boolean; color?: string }> };
    bonds: { manual: { add: unknown[]; remove: unknown[] } };
  };
  bondsDrawn(): boolean;
  appearanceMs(): number;
}

// The Specimen tab's crystal view (src/ui/CrystalPane.svelte).
interface BeamViewHook {
  overlayCount(): number;
  viewState(): { direction: number[]; up: number[]; visibleHeight: number };
}

interface Window {
  __crystallens: CrystalLensHook;
  __beamview: BeamViewHook;
}
