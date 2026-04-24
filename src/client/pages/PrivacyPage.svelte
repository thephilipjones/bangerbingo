<script lang="ts">
  import ThemeToggle from '../lib/components/ThemeToggle.svelte'
  import Logo from '../lib/components/Logo.svelte'
</script>

<div class="privacy-page">
  <div class="top-bar">
    <a href="/" class="home-link">
      <Logo size={32} variant="full" />
    </a>
    <ThemeToggle />
  </div>

  <main class="content">
    <h1>Privacy Policy</h1>
    <p class="last-updated">Last updated: April 2026</p>

    <section>
      <h2>What BangerBingo is</h2>
      <p>BangerBingo is a music bingo party game. One person (the <strong>host</strong>) signs in with their Spotify account, picks a playlist, and streams music for their group. Guests join by entering a room code — they never sign in to Spotify.</p>
    </section>

    <section>
      <h2>What we collect</h2>
      <p>We collect only what is necessary for the host login flow:</p>
      <ul>
        <li><strong>Spotify user ID</strong> — your unique Spotify identifier, used as your account key.</li>
        <li><strong>Display name</strong> — shown in the app UI.</li>
        <li><strong>Email address</strong> — collected from Spotify's <code>/v1/me</code> endpoint; may be empty if Spotify does not return it.</li>
        <li><strong>Access token and refresh token</strong> — required to play music from your Spotify account and keep your session active. Stored server-side only; never sent to guest clients.</li>
      </ul>
      <p>Guests who join a room provide only a display name. No account, no email, no Spotify login.</p>
    </section>

    <section>
      <h2>What we read from Spotify on your behalf</h2>
      <ul>
        <li>Your profile (<code>/v1/me</code>) — to identify your account.</li>
        <li>Your playlists (<code>/v1/me/playlists</code>, <code>/v1/search</code>) — to let you choose a playlist for the game.</li>
        <li>Playlist tracks (<code>/v1/playlists/{'{id}'}/items</code>) — to generate bingo cards.</li>
        <li>Playback state and controls — to play, pause, and skip tracks during a game.</li>
      </ul>
    </section>

    <section>
      <h2>How we use it</h2>
      <p>Your data is used solely to operate the game. We do not sell, share, or analyse your data for any other purpose.</p>
    </section>

    <section>
      <h2>Data retention</h2>
      <p>Your host account and tokens are retained until you log out. Logging out deletes your tokens from our database immediately. Room history (which songs were played) may persist briefly in session storage and is cleared when a session ends.</p>
    </section>

    <section>
      <h2>Security</h2>
      <p>Tokens are stored server-side in a SQLite database on the host machine and are never exposed to the client beyond what the Spotify Web Playback SDK requires. Sessions are authenticated with HMAC-signed cookies.</p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>Questions? Reach out to the app operator directly — contact details are available through the same channel that gave you access to this app.</p>
    </section>
  </main>
</div>

<style>
  .privacy-page {
    min-height: 100dvh;
    background: var(--bg);
    color: var(--fg);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .home-link {
    display: flex;
    align-items: center;
    text-decoration: none;
  }

  .content {
    max-width: 48rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  h1 {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 4vw, 2rem);
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    margin: 0;
  }

  h2 {
    font-family: var(--font-display);
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: var(--track-display);
    margin: 0 0 var(--space-3);
    color: var(--fg-muted);
  }

  p, li {
    font-family: var(--font-body);
    font-size: 1rem;
    line-height: 1.6;
    margin: 0 0 var(--space-2);
  }

  ul {
    padding-left: var(--space-5);
    margin: 0 0 var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  section {
    display: flex;
    flex-direction: column;
  }

  .last-updated {
    color: var(--fg-muted);
    font-size: 0.875rem;
    margin: calc(-1 * var(--space-4)) 0 0;
  }

  code {
    font-family: var(--font-mono, monospace);
    font-size: 0.875em;
    background: var(--bg-elevated, transparent);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
</style>
