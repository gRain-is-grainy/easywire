const checkbox = document.getElementById('enabled');

chrome.storage.local.get('enabled').then(({ enabled }) => {
  checkbox.checked = enabled !== false;
});

checkbox.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
});

// Compare the installed version with main's manifest on GitHub.
// Stays hidden when offline or if GitHub can't be reached.
const REMOTE_MANIFEST = 'https://raw.githubusercontent.com/gRain-is-grainy/easywire/main/manifest.json';

fetch(REMOTE_MANIFEST, { cache: 'no-store' })
  .then((res) => res.json())
  .then(({ version }) => {
    if (!EasywireVersion.isNewer(version, chrome.runtime.getManifest().version)) return;
    document.getElementById('update-version').textContent = version;
    document.getElementById('update').hidden = false;
  })
  .catch(() => {});

// For an unpacked extension this re-reads every file from disk, same as the reload button on chrome://extensions.
document.getElementById('reload').addEventListener('click', () => chrome.runtime.reload());
