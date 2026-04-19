<script lang="ts">
  import emblem01 from '../assets/free-tile/emblem-01-skull.svg?url'
  import emblem02 from '../assets/free-tile/emblem-02-rose.svg?url'
  import emblem03 from '../assets/free-tile/emblem-03-flaming-heart.svg?url'
  import emblem04 from '../assets/free-tile/emblem-04-dice.svg?url'
  import emblem05 from '../assets/free-tile/emblem-05-serpent-mic.svg?url'
  import emblem06 from '../assets/free-tile/emblem-06-lightning-record.svg?url'
  import emblem07 from '../assets/free-tile/emblem-07-anchor-roses.svg?url'
  import emblem08 from '../assets/free-tile/emblem-08-pyramid-eye.svg?url'
  import emblem09 from '../assets/free-tile/emblem-09-cassette-thorns.svg?url'
  import emblem10 from '../assets/free-tile/emblem-10-skull-guitar.svg?url'
  import emblem11 from '../assets/free-tile/emblem-11-horseshoe.svg?url'
  import emblem12 from '../assets/free-tile/emblem-12-moth-moon.svg?url'

  const EMBLEMS = [
    emblem01, emblem02, emblem03, emblem04,
    emblem05, emblem06, emblem07, emblem08,
    emblem09, emblem10, emblem11, emblem12,
  ]

  let { seed = 0 }: { seed?: number } = $props()
  const src = $derived(EMBLEMS[Math.abs(seed) % EMBLEMS.length])
</script>

<img class="emblem" {src} alt="Free space" />

<style>
  .emblem {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
</style>
