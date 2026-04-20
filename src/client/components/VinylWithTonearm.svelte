<script lang="ts"></script>

<div class="vinyl-scene" aria-hidden="true">
  <svg viewBox="0 0 115 90" width="115" height="90">
    <g class="vinyl">
      <circle cx="45" cy="45" r="38" fill="var(--fg)" stroke="var(--fg)" stroke-width="1.5"/>
      <circle cx="45" cy="45" r="34" fill="none" stroke="var(--bg-2)" stroke-width="1.5" opacity="0.5"/>
      <circle cx="45" cy="45" r="30" fill="none" stroke="var(--bg-2)" stroke-width="1" opacity="0.5"/>
      <circle cx="45" cy="45" r="26" fill="none" stroke="var(--bg-2)" stroke-width="1" opacity="0.5"/>
      <circle cx="45" cy="45" r="18" fill="var(--accent)"/>
      <rect x="43.5" y="29" width="4" height="9" rx="1.5" fill="var(--bg)" opacity="0.6"/>
      <circle cx="45" cy="45" r="3.5" fill="var(--bg)"/>
    </g>
    <line x1="103" y1="7" x2="68" y2="24" stroke="var(--fg-muted)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="103" cy="7" r="5" fill="var(--fg)" stroke="var(--fg-muted)" stroke-width="1.5"/>
    <circle cx="68" cy="24" r="3" fill="var(--bg)" stroke="var(--fg)" stroke-width="1"/>
  </svg>
</div>

<style>
  .vinyl-scene {
    line-height: 0;
  }

  .vinyl {
    transform-origin: 45px 45px;
    animation: spin 3s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .vinyl { animation: none; }
  }
</style>
