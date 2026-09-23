# easywire — Campuswire feed enhancer (design)

Date: 2026-09-22
Status: approved in chat, pending written-spec review

## Goal

A personal Chrome extension that makes the Campuswire class feed easier to follow:

1. The time on each feed item reflects the **latest activity** (post or newest reply), not just the post time.
2. Each feed item shows its **reply count**, right after the time, in the same style.
3. A **"Recent activity"** toggle sorts the whole feed by latest activity.
4. **Personal pins**: pin any post; pinned posts appear in a "My pins" section at the top of the feed.
5. An **on/off switch** in the toolbar popup.

For personal use only (loaded unpacked, not published). Target: Chromium browsers (Chrome/Edge/Brave), Manifest V3.

## Hard constraint: read-only

The extension must never change anything on Campuswire: no posting, replying, editing, reacting, marking viewed, changing settings, or leaving classes. The only network requests it makes are `GET`s to the two read endpoints below. This is enforced in code (see `page-hook.js`).

## Observed Campuswire facts (recon 2026-09-22)

- Feed page URL: `https://campuswire.com/c/{groupSlug}/feed`; post URL: `/c/{groupSlug}/feed/{number}` (e.g. `/c/GBC3CC03C/feed/39`).
- API base `https://api.campuswire.com/v1`. Auth is an `authorization: Bearer …` **request header** (not a cookie).
- Feed list: `GET /group/{groupId}/posts?number=20`, older pages `…&before={publishedAt of last post}`. Fewer than 20 results = last page. Posts are returned newest `publishedAt` first.
- Post fields used: `id`, `number`, `title`, `body`, `publishedAt`, `likesCount`, `type` (`question`/`note`), `answeredAt`, `read`. **`updatedAt` does not change on new comments** and `answersCount` is only 0/1, so neither can be used for activity or count.
- Replies: `GET /group/{groupId}/posts/{postId}/comments` returns a **flat array of all replies at every depth**, each with `id`, `createdAt`, `publishedAt`, `answer`, `depth`. Example: post #39 → 6 comments, newest `2026-09-21T01:21Z`, while post `updatedAt` was `2026-09-20T02:02Z`.
- Opening a post triggers a separate `POST …/viewed`; fetching `/comments` alone does not mark anything viewed.
- Feed item DOM:
  ```html
  <div role="button" class="post-preview-wrapper …">
    …<div class="post-preview">
      <div class="post-title …"><h3>Title</h3><span class="post-ref">#40</span></div>
      <div class="post-text-wrap …">…</div>
      <div class="post-preview-footer …">
        <div class="post-time"><span class="post-likes"><i class="far fa-thumbs-up"></i>0</span><i class="far fa-clock"></i>2 days</div>
        <div class="post-preview-stats"></div>
      </div>
    </div>
  </div>
  ```
- Relative-time strings seen: `12 hours`, `a day`, `2 days`, `3 days` (moment.js `fromNow(true)` style).
- Campuswire has its own instructor "Pinned posts" panel; our pins are separate and personal.

## Architecture

Plain JavaScript, no build step, no runtime dependencies.

| File | Runs in | Responsibility |
|---|---|---|
| `manifest.json` | — | MV3. Matches `https://campuswire.com/*` only. Permissions: `storage`, `unlimitedStorage` (per-class caches must not hit the 10 MB local cap). Registers `page-hook.js` as a MAIN-world content script at `document_start`, the rest as isolated-world content scripts. |
| `src/page-hook.js` | page (MAIN world) | Wraps `window.fetch` and `XMLHttpRequest`. Captures the `authorization` header from the page's own API requests (it never leaves the page world). When the page requests its first feed page (`GET …/group/{g}/posts` without `before`/`category`), posts `{type: "feed", groupId}` to the content script via `window.postMessage`. Performs the extension's fetch requests on its behalf, **rejecting any request whose method is not `GET` or whose URL does not match `^https://api\.campuswire\.com/v1/group/{id}/posts(?:\?number=\d+(?:&before=[A-Za-z0-9%._-]+)?|/{id}/comments)$` with `{id}` = `[A-Za-z0-9-]+`** (URL rules live in `src/guard.js`). |
| `src/guard.js` | page (MAIN world), pure | `isApiUrl(url)`, `isAllowedRequest(method, url)`, `feedGroupId(url)` — the read-only URL rules, unit-tested. |
| `src/activity.js` | pure | `summarize(post, comments) → {replyCount, lastActivityAt}`; `sortByActivity(posts, summaries)`; `formatRelative(date, now)`. |
| `src/fetcher.js` | content script | Pages through all posts; fetches `/comments` per post with concurrency 3; caches slim posts + summaries in `chrome.storage.local` keyed by `groupId`, saving progress every 20 summaries. Paging stops on an empty page or one that does not move `before`. Keeps the refresh throttle and 401/429 pause in storage so they survive reloads. |
| `src/pins.js` | content script | Pins in `chrome.storage.sync` as `{ pins: { [groupId]: [postId, …] } }`. `list(groupId)`, `toggle(groupId, postId)`, `prune(groupId, existingIds)`. |
| `src/render.js` | content script | Decorates native feed items, draws "My pins" section and the sorted list, the toggle. All DOM selectors in one `SELECTORS` object. |
| `src/content.js` | content script | Wires everything: receives messages from `page-hook`, observes the feed with a `MutationObserver`, detects group changes from the URL, triggers fetch/render. |
| `src/popup/` | extension popup | `popup.html` + `popup.js`: the on/off checkbox (`enabled` in `chrome.storage.local`). |
| `src/styles.css` | — | Minimal extra styles (pin icon, toggle, section header); otherwise reuse Campuswire classes. |
| `tests/*.test.js` | Node `node --test` | Unit tests for `activity.js`, `pins.js`, `guard.js`, `fetcher.js` (storage/network stubbed), `page-hook.js` (in a `vm` sandbox with fake fetch/XHR), and `render.js` pure helpers. |

`activity.js`, `pins.js`, `guard.js`, `fetcher.js`, and `render.js` must be loadable both as content scripts and by Node tests (e.g. attach to `globalThis` and `module.exports` when defined).

## Behavior

### Data flow

1. Page loads its first feed page; `page-hook` captures the auth header and reports the current `groupId`.
2. `content.js` renders immediately from cached summaries (if any), then `fetcher` pages through `before=` until the end and fetches `/comments` for every post (concurrency 3), updating cache and re-rendering as results arrive.
3. `lastActivityAt = max(post.publishedAt, max(comment.createdAt))`; `replyCount = comments.length` (answers + all nested replies).
4. Refresh happens on each feed load or group switch (group id from the intercepted first-page feed request). A repeat feed request for the same group within 60 s (tracked across reloads) shows the cache without fetching; one arriving while that group is still being fetched is ignored so its progress is kept. No network polling; relative times are re-rendered every 60 s from cached data.

### Feature 1 & 2 — time and reply count (native items)

- The clock text in `.post-time` is replaced by `formatRelative(lastActivityAt)`; the likes span is untouched.
- A comment icon + N (`far fa-comment`, like the clock's `far fa-clock`) is inserted into `.post-preview-stats`, styled like the time. Shown for N ≥ 0 once known; nothing shown before data arrives.
- Items are matched to data via the `#number` in `.post-ref`, and only decorated when the item's title matches (post numbers are per class, so a mismatch means the data is for another class).
- A missing or unparseable date leaves the native clock text as is.
- `formatRelative` follows moment.js `fromNow(true)` thresholds: <45s `a few seconds`, <90s `a minute`, <45m `N minutes`, <90m `an hour`, <22h `N hours`, <36h `a day`, <26d `N days`, <45d `a month`, <11mo `N months`, <18mo `a year`, else `N years`. Verified against the strings observed on the live page.

### Feature 3 — "Recent activity" toggle

- An icon toggle button (clock icon; tooltip "Sort all posts by latest post or reply") next to the "All categories" dropdown; state persisted in `chrome.storage.local`.
- **On:** the native list is hidden; our own flat list is shown, all posts in the class sorted by `lastActivityAt` desc (ties: higher `number` first), each item rendered with Campuswire's `post-preview-wrapper` markup/classes plus time, count, and pin icon. No "This week/Last week" headers. Ignores the category dropdown.
- Clicking an item navigates to `/c/{groupSlug}/feed/{number}` by clicking the matching (hidden) native feed item if it is loaded, so Campuswire's router opens it; otherwise `location.assign('/c/{groupSlug}/feed/{number}')`. Items and the "My pins" header work with Enter/Space.
- **Off:** native list shown, with feature 1 & 2 decorations only.

### Feature 4 — personal pins

- A pin icon at the right of each feed item's footer (native and ours), sized like Campuswire's 16px check-mark circle and directly below it, so the title row keeps Campuswire's layout: visible on hover, always visible when pinned. Click toggles the pin and does not open the post.
- A collapsible "My pins" section at the top of the feed list in both modes, sorted by `lastActivityAt` desc, same item rendering.
- Pins are per class, stored in `chrome.storage.sync`. After a full fetch, pinned ids not found in the class's posts are pruned; an empty post list for a class with cached posts counts as a failed fetch and prunes nothing. If sync storage is full, the user is told the pin was not saved.

### Feature 5 — on/off switch

- Clicking the toolbar icon opens a popup with one checkbox, stored as `enabled` in `chrome.storage.local` (default on). Takes effect immediately in open tabs.
- **Off:** no fetching (a running crawl is cancelled) and every easywire addition is removed; native clock text is restored. `page-hook.js` still loads but only answers our requests.

## Error handling

- **No auth header yet:** render what's available; start fetching when the first header is captured.
- **Single `/comments` failure:** keep cached summary (or fall back to `publishedAt`, no count); retry on next load.
- **HTTP 401/429:** stop fetching for 10 minutes (across reloads and classes), keep cache, show "activity data paused" in the toggle's tooltip.
- **DOM changes:** if `SELECTORS` don't match, do nothing (never break the page); log one console warning.

## Testing

- `node --test`: `summarize` (no comments, nested comments, comment older than post), `sortByActivity` (ordering, ties), `formatRelative` (each threshold, incl. `12 hours`, `a day`, `2 days`), pins (toggle on/off, per-group isolation, prune).
- Manual: load unpacked on the user's class; user performs all clicks; verify times/counts against opened posts, toggle order, pin/unpin, persistence across reload.

## Out of scope

Firefox, notifications, hiding/filtering posts, search, category filtering in the sorted view, polling for live updates.
