# Adding a new host to Bangerbingo

Bangerbingo runs against a Spotify app in **Development Mode**, which limits logins to an explicit allowlist of up to **5 Spotify users** (cap as of Feb 2026). Friends cannot self-register — each one has to be added manually in the Spotify Developer Dashboard.

## Steps

### 1. Collect from your friend

- **Spotify display name** — exactly as it appears on their Spotify profile (case + spacing matters).
- **Email address on their Spotify account** — must match the email Spotify has on file, character-exact.

The easiest path: friend hits the `/login` page, clicks **Connect Spotify**, gets bounced to `/login?error=spotify_denied`, and uses the **Copy request message** button — it copies a pre-formatted message with the two fields above to their clipboard. They send it to you through whatever channel they already use (iMessage, Slack, DM — same channel that told them about the app). The app intentionally does not embed your email address in the client bundle to avoid public-internet spam harvesting.

### 2. Add them in the Spotify Developer Dashboard

1. Open [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and sign in.
2. Select the **Bangerbingo** app.
3. Go to **Settings** → **User Management** (historically called **Users and Access**; Spotify renames this periodically).
4. Click **Add New User**.
5. Paste the **display name** and **email** from step 1. Both must match character-exactly.
6. Save.

### 3. Confirm it worked

- Send the friend the app URL.
- Ask them to click **Connect Spotify** again.
- They should pass through the Spotify consent screen and land on the host page instead of the error screen.
- If they still see "private beta" after step 2, the most common culprit is a **character mismatch** on the email (trailing space, wrong domain case, different email than the one on their Spotify account).

## The 5-user cap

The allowlist includes **you**. Practical slots for friends: 4.

When the cap is hit, your options are:

1. **Remove an inactive user** from the dashboard to free a slot.
2. **Apply for Extended Quota Mode** — Spotify reviews the app and lifts the cap. The draft materials live at [docs/spotify-extended-quota-application.md](spotify-extended-quota-application.md). Review is not instant (can take weeks); prepare early.

## Troubleshooting

| Symptom                                          | Likely cause                                                                          |
|--------------------------------------------------|---------------------------------------------------------------------------------------|
| "Bangerbingo is in private beta…"                | Not allowlisted yet, or email/display name in dashboard doesn't match Spotify account |
| "Login timed out. Click Connect Spotify…"        | Friend took longer than 5 min at the Spotify consent screen; just retry               |
| "Spotify login didn't complete"                  | Transient Spotify token exchange failure; retry usually fixes it                      |
| "Couldn't reach Spotify to confirm your account" | Network issue on their end                                                            |
| "Something went wrong on our end"                | Server-side DB error; check server logs                                               |

These strings map 1:1 to the error-code branches in [src/client/pages/LoginPage.svelte](../src/client/pages/LoginPage.svelte), which in turn come from the `?error=<code>` redirects in [src/server/auth.ts](../src/server/auth.ts).
