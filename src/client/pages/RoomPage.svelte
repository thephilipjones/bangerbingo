<script lang="ts">
  let { name }: { name: string } = $props()
</script>

<div class="room-page">
  <p>Welcome, {name}! Waiting for the host to start a round...</p>
</div>

<style>
  .room-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: sans-serif;
  }
</style>
