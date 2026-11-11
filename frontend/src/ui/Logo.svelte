<script lang="ts">
  // The SimulateUI mark: a convergent electron probe focused onto a crystal lattice (the favicon,
  // public/favicon.svg, is the same drawing).
  let { size = 40 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" class="logo">
  <defs>
    <linearGradient id="em-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7a1f33" />
      <stop offset="1" stop-color="#c2562e" />
    </linearGradient>
    <linearGradient id="em-cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.05" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.45" />
    </linearGradient>
    <radialGradient id="em-atom" cx="0.35" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#f6d5dc" />
    </radialGradient>
  </defs>
  <rect width="48" height="48" rx="12" fill="url(#em-bg)" />
  <!-- the probe: a cone converging to its crossover on the specimen -->
  <path d="M13 5 24 27 35 5z" fill="url(#em-cone)" />
  <path
    d="M13 5 24 27 35 5"
    fill="none"
    stroke="#fff"
    stroke-opacity="0.9"
    stroke-width="1.6"
    stroke-linejoin="round"
  />
  <!-- the lattice: two offset rows of atoms -->
  <g fill="url(#em-atom)">
    <circle cx="10" cy="32" r="2.6" />
    <circle cx="19" cy="32" r="2.6" />
    <circle cx="29" cy="32" r="2.6" />
    <circle cx="38" cy="32" r="2.6" />
    <circle cx="14.5" cy="40" r="2.6" />
    <circle cx="24" cy="40" r="2.6" />
    <circle cx="33.5" cy="40" r="2.6" />
  </g>
  <circle cx="24" cy="27" r="3.2" fill="#fde68a" />
</svg>

<style>
  .logo {
    display: block;
    flex: none;
    filter: drop-shadow(0 2px 6px rgba(122, 31, 51, 0.3));
  }
</style>
