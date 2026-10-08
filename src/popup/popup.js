const REPO = 'https://github.com/gRain-is-grainy/easywire';
const REMOTE_MANIFEST = 'https://raw.githubusercontent.com/gRain-is-grainy/easywire/main/manifest.json';
const $ = (id) => document.getElementById(id);

const version = chrome.runtime.getManifest().version;
$('version').textContent = `v${version}`;
$('notes').href = `${REPO}/releases/tag/v${version}`;

// --- on/off ---
const checkbox = $('enabled');

function showEnabled(on) {
  checkbox.checked = on;
  document.body.classList.toggle('off', !on);
  $('power-title').textContent = on ? 'easywire is on' : 'easywire is off';
  $('power-detail').textContent = on ? 'Activity times, reply counts and pins' : 'Campuswire is back to normal';
}

chrome.storage.local.get('enabled').then(({ enabled }) => {
  showEnabled(enabled !== false);
  // Let the stored state paint without animating, then turn transitions on.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('preload')));
});

checkbox.addEventListener('change', () => {
  showEnabled(checkbox.checked);
  chrome.storage.local.set({ enabled: checkbox.checked });
});

// --- class status for the current tab ---
async function loadStatus() {
  let groupId = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    groupId = (await chrome.tabs.sendMessage(tab.id, { type: 'status' })).groupId;
  } catch {
    // Not a Campuswire tab, or it was open before easywire loaded.
  }
  const keys = groupId ? [`cache:${groupId}`, `refreshedAt:${groupId}`, 'pausedUntil'] : [];
  const stored = await chrome.storage.local.get(keys);
  const cache = stored[`cache:${groupId}`];
  const lines = EasywireStatus.statusLines({
    groupId,
    postCount: cache ? cache.posts.length : 0,
    refreshedAt: stored[`refreshedAt:${groupId}`],
    pausedUntil: stored.pausedUntil,
    now: Date.now(),
  });
  $('status-title').textContent = lines.title;
  $('status-detail').textContent = lines.detail;
}

loadStatus();

// --- update check against main's manifest on GitHub; stays hidden if it can't be reached ---
fetch(REMOTE_MANIFEST, { cache: 'no-store' })
  .then((res) => res.json())
  .then((remote) => {
    if (!EasywireVersion.isNewer(remote.version, version)) return;
    $('update-version').textContent = remote.version;
    $('reload').tabIndex = 0;
    $('update').classList.add('shown');
  })
  .catch(() => {});

// For an unpacked extension this re-reads every file from disk, same as the reload button on chrome://extensions.
// The short delay lets the spin play before the popup closes.
$('reload').addEventListener('click', () => {
  $('reload').classList.add('busy');
  $('reload-label').textContent = 'Reloading…';
  setTimeout(() => chrome.runtime.reload(), 450);
});
