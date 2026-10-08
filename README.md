<div align="center">

# easywire

**See what's actually new on Campuswire.**

Latest-activity times, reply counts, a "Recent activity" sort, and personal pins for the Campuswire class feed. Read-only, with no dependencies and no build step.

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](manifest.json)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](src)
[![Node Test Runner](https://img.shields.io/badge/node_--test-96_passing-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](tests)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-555555?style=for-the-badge)](#architecture)

[Features](#features) · [How it stays read-only](#how-it-stays-read-only) · [Architecture](#architecture) · [Getting Started](#getting-started)

</div>

---

## Why easywire?

Campuswire's feed shows when a post was *created*, not when someone last replied to it. A question from last week that just got a TA answer sits buried with a stale "7 days" timestamp and no hint that anything changed. The post's `updatedAt` doesn't move on new comments, and `answersCount` only ever reads 0 or 1, so the page itself has no way to tell you.

easywire fetches the replies for every post in the class, works out each post's real latest activity, and writes it back into the feed you already use.

## Features

### Feed
- **Latest-activity times** —> each post's clock shows the newest reply time, not the original post time, using the same moment.js wording Campuswire uses (`12 hours`, `a day`, `3 days`)
- **Reply counts** —> every feed item shows its total replies at every depth, right next to the time
- **Recent activity sort** —> a new option in Campuswire's own category dropdown that re-orders the whole class feed by latest activity
- **Native look** —> sorted and pinned cards reuse Campuswire's layout and post-type icons (pen for notes, check for resolved questions)
- **Avatars and presence** —> pinned and sorted cards show the author's avatar with a live online dot, plus Campuswire's unread dot and new-comment badge
- **Anonymous icons** —> anonymous posts get Campuswire's own anonymous avatar instead of the blank spot the page leaves, on native cards too

### Pins
- **Personal pins** —> pin any post; pinned posts show up in a collapsible "My pins" section at the top of the feed
- **Synced** —> pins live in `chrome.storage.sync`, per class, and follow you across browsers
- **Self-cleaning** —> pins for deleted posts are pruned, but only after a *complete* refresh, so a failed request never wipes them

### Export
- **Copy the whole class** —> an "Export" item under "Recent activity" copies every post (or a date range, or picked posts) with its full reply thread as plain text, ready to paste into an AI chat
- **Date range** —> with nothing selected, Export opens a dialog: pick "published between" dates (both optional) and export just those posts, e.g. everything since the last quiz
- **Pick posts** —> "Select posts" puts a checkbox under every card's avatar, Campuswire's own included, so you can use its category filter while picking; copy them from the bar or the Export item
- **Drag to select** —> hold and drag across cards to select a whole run (or deselect it, if you started on a selected card); the feed auto-scrolls when you reach its top or bottom edge
- **Sticky bar** —> the selection count, Cancel and Copy stay pinned to the top of the feed while you scroll
- **No extra requests** —> threads are saved during the normal crawl, so the copy is instant; posts whose replies haven't loaded yet are marked

### Well-behaved
- **Cached per class** —> posts and reply summaries are stored locally, so revisits render instantly and only refresh when needed
- **Throttled** —> at most 3 concurrent requests and one refresh per class per minute; the throttle survives reloads
- **Backs off** —> a 401 or 429 from Campuswire pauses all fetching for 10 minutes
- **On/off switch** —> the toolbar popup turns easywire off instantly, cancels any in-flight crawl, and removes all of its UI
- **Update notice** —> the popup checks `main`'s manifest on GitHub and, when a newer version is out, shows it with a Reload button

## How it stays read-only

easywire never posts, replies, edits, reacts, marks posts viewed, or changes settings. This is enforced in code:

- Only `src/page-hook.js` makes network requests, and every one passes through `EasywireGuard.isAllowedRequest` first.
- The guard accepts `GET` requests only, and only for two URL shapes: the post list (`/v1/group/{id}/posts?number=N[&before=…]`) and a post's comments (`/v1/group/{id}/posts/{id}/comments`). Anything else is refused, including `POST`, `/viewed`, `..` segments, and look-alike hosts.
- Fetching `/comments` doesn't mark a post viewed. That only happens when you open the post yourself.
- Online status is read passively from Campuswire's own `/v1/users` responses and presence WebSocket frames, and unread comment counts from its socket's `ready` frame. easywire never requests either.
- Your Campuswire auth header is read from the page's own requests and never leaves the page's JavaScript context. The extension's isolated scripts never see it.

## Architecture

```mermaid
flowchart LR
    CW["Campuswire page"]
    API[("api.campuswire.com")]
    POPUP["Toolbar popup"]

    subgraph MAIN["MAIN world (page context)"]
        HOOK["page-hook.js<br/>wraps fetch / XHR / WebSocket"]
        GUARD["guard.js<br/>GET + allowlisted URL only"]
    end

    subgraph ISO["Isolated world (extension context)"]
        CONTENT["content.js<br/>wiring + MutationObserver"]
        FETCH["fetcher.js<br/>page posts, summarize replies"]
        PINS["pins.js<br/>list / toggle / prune"]
        RENDER["render.js<br/>decorates Campuswire's feed"]
        EXPORT["export.js<br/>posts + threads as text"]
    end

    subgraph STORE["Chrome storage"]
        LOCAL[("storage.local<br/>per-class cache + enabled flag")]
        SYNC[("storage.sync<br/>pins")]
    end

    CW -- "its own requests:<br/>auth, class id, presence" --> HOOK
    HOOK -- "easywire's GETs" --> GUARD
    GUARD -- "allowed" --> API
    HOOK <-- "postMessage bridge" --> CONTENT
    CONTENT --> RENDER
    CONTENT --> FETCH
    CONTENT --> PINS
    CONTENT --> EXPORT
    FETCH --> LOCAL
    PINS --> SYNC
    POPUP -- "enabled flag" --> LOCAL
```

### Main technologies

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest V3, MAIN-world + isolated-world content scripts (Chrome 111+) |
| Language | Plain JavaScript, no build step, no runtime or dev dependencies |
| Storage | `chrome.storage.local` (+ `unlimitedStorage`) for caches, `chrome.storage.sync` for pins |
| Tests | Node's built-in test runner (`node --test`) |

### Repository layout

```text
.
├── manifest.json          # MV3 manifest, matches https://campuswire.com/* only
├── src/
│   ├── guard.js           #   Read-only URL rules (MAIN world, pure)
│   ├── page-hook.js       #   Wraps fetch/XHR/WebSocket, captures auth + presence, serves allowed GETs
│   ├── activity.js        #   summarize, sortByActivity, formatRelative (pure)
│   ├── pins.js            #   Serialized pin list/toggle/prune over storage
│   ├── fetcher.js         #   Paging, reply summaries, cache, throttle, pause
│   ├── render.js          #   Feed decorations, My pins, sorted list, dropdown items, selection + drag-select
│   ├── export.js          #   Formats posts + threads as plain text (pure)
│   ├── content.js         #   Wires everything together
│   ├── styles.css
│   └── popup/             #   On/off toggle, update notice + reload
└── tests/                 # One test file per pure module + renderer
```

## Getting Started

### Prerequisites

- A Chromium browser (Chrome, Edge, Brave), version 111+
- Node.js 18+ (only needed to run the tests)

### Install

1. Clone the repo:
   ```bash
   git clone https://github.com/gRain-is-grainy/easywire.git
   ```
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `easywire` folder.
4. Open any class feed on [campuswire.com](https://campuswire.com). Activity times and reply counts fill in as the first crawl finishes.

To pick up code changes, hit the reload button on the extension card and refresh Campuswire.

### Updating

When the toolbar popup says **Update available**, run `git pull` in the `easywire` folder, click **Reload extension** in the popup, then refresh Campuswire. Releases bump `version` in `manifest.json`, which is what the popup compares against.

### Tests

```bash
node --test                  # runs everything in tests/
```

---

<div align="center">

If easywire helped you catch a TA answer on a week-old question, star the repo.

</div>
