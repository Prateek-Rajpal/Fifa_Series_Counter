# FC 26 series log

A weekly-game-night tracker for three players. Series of five matches, series
standings, per-match scorecards, goalscorers, team records, head-to-head,
records board and a shareable standings image. Matches are tagged by game
(FC 26, FC 27, …) so the stats can be filtered. Works offline,
optionally syncs across phones through a Cloudflare Worker and a D1 database.

```
index.html          the whole app — one file, no build step
worker/index.js     sync backend (Cloudflare Worker)
worker/schema.sql   D1 tables
worker/wrangler.toml  only if you deploy via CLI instead of the dashboard
```

## Part 1 — put the app online

The app is a static file. GitHub Pages is the least effort:

1. Push this repo to GitHub, public.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait a minute. Your URL is `https://<username>.github.io/<repo>`.
4. Open it on each phone, then Share → **Add to Home Screen**.

At this point the app works. Each phone keeps its own log. Sync is Part 2.

## Part 2 — deploy the Worker

### Create the database

1. Cloudflare dashboard → **Storage & Databases → D1** → Create database.
2. Name it `fc26`. Create.
3. Open the database → **Console** tab. Paste the whole of `worker/schema.sql`
   and run it. You should end up with three tables: `series`, `matches`,
   `settings`.

### Create the Worker

1. **Compute (Workers) → Create → Worker**. Name it `fc26-sync`. Deploy the
   starter as-is; you'll replace the code next.
2. Open the Worker → **Edit code**. Delete what's there, paste all of
   `worker/index.js`, and hit **Deploy**.

### Bind the database to the Worker

1. Worker → **Settings → Bindings → Add → D1 database**.
2. Variable name: `DB` — this must be exactly `DB`, the code reads `env.DB`.
3. Database: `fc26`. Save, then **Deploy** again.

### Check it

Open `https://fc26-sync.<your-subdomain>.workers.dev/health` in a browser.
You want `{"ok":true,...}`. If you get an error about a missing D1 binding,
the binding didn't save or the Worker wasn't redeployed after adding it.

## Part 3 — connect the phones

On each phone: app → **Setup → Shared log**

- Address: your `https://fc26-sync.<subdomain>.workers.dev` URL
- Room code: any shared string, 4–64 characters, letters/numbers/dashes
  (e.g. `thursday-lads`). All three phones must type it identically.

Tap **Sync now**. After that it syncs automatically on open, when the app comes
back to the foreground, when the network returns, and about 1.5 seconds after
any change.


## How a series is decided

**Match wins, and nothing else.** Win 3 of 5 and the series is yours no matter
what the scorelines were — you can win a series on a goal difference of minus
fifteen. Level on wins is a **drawn series**, and a drawn series counts for
nobody in the standings. Goal difference is recorded and displayed but never
breaks a tie.

There is no points system. A drawn match counts for neither player: nothing is
added for it and nothing is deducted for a loss. The Table tab is a record of
what happened — played, won, drawn, lost, goals for and against — not a
league table.

## How sync works

Local storage stays the source of truth, so the app never blocks on the
network. Sync is a push of everything changed since the last successful push,
followed by a full pull.

- **Rows, not blobs.** Each match is its own row with its own ID. Two phones
  logging different matches at the same time don't collide.
- **Last writer wins.** Every record carries an `updated` timestamp. The
  upsert only overwrites when the incoming row is newer, so an old row
  arriving late is ignored rather than winning.
- **Deletes are tombstones.** A deleted match stays in the database with
  `deleted = 1`. Without this, a phone that hadn't synced would push its copy
  back and resurrect it.

### Known trade-offs

- **Clock skew decides conflicts.** Timestamps come from the phones. If one
  phone's clock is minutes ahead, it wins edit conflicts. Only matters if two
  people edit the *same* match at the same time, which is rare.
- **Settings are one blob.** Player names, team list, series length and
  carry-over numbers sync together, last-write-wins. Two people editing names
  in the same minute means one edit is lost.
- **The room code is the only security.** Anyone with the URL and the code can
  read and write. Fine for three friends and a football score; don't put
  anything else in there.
- **Backups still matter.** Setup → Save backup file. The Worker is not a
  backup — a bad sync or a deleted D1 database takes everything with it.

### Free tier

Cloudflare Workers free plan covers 100,000 requests/day and D1 gives 5 GB with
100,000 row writes/day. Three people logging five matches a week won't come
close. No credit card required.

## Security notes

- **`ALLOWED_ORIGINS`** at the top of `worker/index.js` lists the sites allowed
  to call the Worker from a browser. Update it if your Pages URL differs.
  Set `ALLOW_ANY_ORIGIN = true` only while testing.
- **CORS restrains browsers only.** `curl` ignores it. The room code is the
  real access control, so make it long and random.
- **The CSP meta tag** in `index.html` limits where the page can send data.
  It currently allows any `*.workers.dev` host; narrowing it to your own
  Worker URL is the strongest setting.
- **Repo write access equals backend write access**, because Workers Builds
  deploys from the repo. Keep 2FA on the GitHub account.
