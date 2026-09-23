(function (root) {
  const SELECTORS = {
    column: '.left-col-2',
    nativeList: '.left-col-2 .posts-list-wrap:not(.ew-root)',
    categoryWrap: '.left-col-2 .sidebar-category-wrap',
    categoryDropdown: '.dropdown-btn-wrapper',
    item: '.post-preview-wrapper',
    title: '.post-title',
    ref: '.post-ref',
    time: '.post-time',
    stats: '.post-preview-stats',
  };
  let handlers = null;
  let warned = false;

  function postNumberFromRef(text) {
    const match = /#(\d+)/.exec(text || '');
    return match ? Number(match[1]) : null;
  }

  function groupSlugFromPath(path) {
    const match = /^\/c\/([^/]+)/.exec(path || '');
    return match ? match[1] : null;
  }

  function escapeHtml(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (c) => map[c]);
  }

  function countHtml(count) {
    return `<span class="post-time ew-count"><i class="far fa-comment"></i><span>${Number(count)}</span></span>`;
  }

  function pinHtml(postId, pinned) {
    return `<button type="button" class="ew-pin${pinned ? ' is-pinned' : ''}" data-post-id="${escapeHtml(postId)}" title="${pinned ? 'Unpin' : 'Pin'}"><i class="fas fa-thumbtack"></i></button>`;
  }

  function itemHtml(post, view) {
    const number = Number(post.number) || 0;
    const check = post.answered ? '<div class="post-type-icon"><i class="fas fa-check"></i></div>' : '';
    const count = view.count === null ? '' : countHtml(view.count);
    return (
      `<div role="button" tabindex="0" class="post-preview-wrapper d-flex align-items-start ew-item" data-number="${number}">` +
      '<div class="post-preview">' +
      `<div class="post-title d-flex justify-content-between"><h3>${escapeHtml(post.title)}</h3><span class="post-ref">#${number}</span>${pinHtml(post.id, view.pinned)}</div>` +
      `<div class="post-text-wrap d-flex justify-content-between align-items-center"><div class="post-text">${escapeHtml(post.body)}</div>${check}</div>` +
      `<div class="post-preview-footer d-flex align-items-center"><div class="post-time"><span class="post-likes"><i class="far fa-thumbs-up"></i>${Number(post.likesCount) || 0}</span><i class="far fa-clock"></i>${escapeHtml(view.time)}</div><div class="post-preview-stats">${count}</div></div>` +
      '</div></div>'
    );
  }

  function viewOf(post, state) {
    const { activityOf, formatRelative } = root.EasywireActivity;
    const summary = state.summaries[post.id];
    return {
      time: formatRelative(activityOf(post, state.summaries), state.now),
      count: summary ? summary.replyCount : null,
      pinned: state.pinnedIds.includes(post.id),
    };
  }

  function setClockText(time, text) {
    const clock = time.querySelector('.fa-clock');
    if (!clock) return;
    let node = clock.nextSibling;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      node = document.createTextNode('');
      clock.after(node);
    }
    if (node.nodeValue !== text) node.nodeValue = text;
  }

  function setCount(stats, count) {
    const existing = stats.querySelector(':scope > .ew-count');
    if (count === null) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      stats.insertAdjacentHTML('beforeend', countHtml(count));
      return;
    }
    const label = existing.lastElementChild;
    const text = String(count);
    if (label.textContent !== text) label.textContent = text;
  }

  function setPin(title, postId, pinned) {
    const existing = title.querySelector(':scope > .ew-pin');
    if (!existing) {
      title.insertAdjacentHTML('beforeend', pinHtml(postId, pinned));
      const button = title.lastElementChild;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation(); // don't let Campuswire open the post
        handlers.onTogglePin(button.dataset.postId);
      });
      return;
    }
    const className = pinned ? 'ew-pin is-pinned' : 'ew-pin';
    if (existing.className !== className) existing.className = className;
    if (existing.dataset.postId !== postId) existing.dataset.postId = postId;
    const label = pinned ? 'Unpin' : 'Pin';
    if (existing.title !== label) existing.title = label;
  }

  function decorateNative(item, byNumber, state) {
    const ref = item.querySelector(SELECTORS.ref);
    const post = byNumber.get(postNumberFromRef(ref && ref.textContent));
    if (!post) return;
    const view = viewOf(post, state);
    const time = item.querySelector(SELECTORS.time);
    if (time) setClockText(time, view.time);
    const stats = item.querySelector(SELECTORS.stats);
    if (stats) setCount(stats, view.count);
    const title = item.querySelector(SELECTORS.title);
    if (title) setPin(title, post.id, view.pinned);
  }

  function ensureToggle(wrap, state) {
    let button = wrap.querySelector(':scope > .ew-toggle');
    if (!button) {
      const html = '<button type="button" class="btn btn-outline ew-toggle"><i class="far fa-clock"></i></button>';
      const dropdown = wrap.querySelector(`:scope > ${SELECTORS.categoryDropdown}`);
      if (dropdown) dropdown.insertAdjacentHTML('afterend', html);
      else wrap.insertAdjacentHTML('beforeend', html);
      button = wrap.querySelector(':scope > .ew-toggle');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handlers.onToggleSorted();
      });
    }
    const className = state.sorted ? 'btn btn-outline ew-toggle is-on' : 'btn btn-outline ew-toggle';
    if (button.className !== className) button.className = className;
    const pressed = String(state.sorted);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    const title = state.paused
      ? 'Activity data paused (Campuswire refused requests); showing cached data'
      : 'Sort all posts by latest post or reply';
    if (button.title !== title) button.title = title;
  }

  function onRootClick(event) {
    event.stopPropagation();
    const pin = event.target.closest('.ew-pin');
    if (pin) {
      handlers.onTogglePin(pin.dataset.postId);
      return;
    }
    if (event.target.closest('.ew-section')) {
      handlers.onToggleCollapsed();
      return;
    }
    const item = event.target.closest('.ew-item');
    if (item) handlers.onOpen(Number(item.dataset.number));
  }

  function rootHtml(state) {
    const { sortByActivity } = root.EasywireActivity;
    const item = (post) => itemHtml(post, viewOf(post, state));
    let html = '';
    const pinned = sortByActivity(state.posts.filter((p) => state.pinnedIds.includes(p.id)), state.summaries);
    if (pinned.length) {
      html += `<div class="filter-by d-flex align-items-center ew-section" role="button"><i class="fas fa-chevron-${state.collapsed ? 'right' : 'down'}"></i> My pins</div>`;
      if (!state.collapsed) html += pinned.map(item).join('');
    }
    if (state.sorted) {
      html += '<div class="filter-by d-flex align-items-center">Recent activity</div>';
      html += sortByActivity(state.posts, state.summaries).map(item).join('');
    }
    return html;
  }

  function renderRoot(nativeList, state) {
    let rootEl = nativeList.parentElement.querySelector(':scope > .ew-root');
    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.className = 'posts-list-wrap default-view ew-root';
      rootEl.addEventListener('click', onRootClick);
    }
    if (rootEl.nextElementSibling !== nativeList) nativeList.before(rootEl);
    const html = rootHtml(state);
    if (rootEl.ewHtml !== html) {
      rootEl.innerHTML = html;
      rootEl.ewHtml = html;
    }
    if (rootEl.hidden !== !html) rootEl.hidden = !html;
  }

  function render(state, nextHandlers) {
    handlers = nextHandlers;
    const nativeList = document.querySelector(SELECTORS.nativeList);
    const categoryWrap = document.querySelector(SELECTORS.categoryWrap);
    if (!nativeList || !categoryWrap) {
      if (!warned && location.pathname.includes('/feed') && document.querySelector(SELECTORS.column)) {
        warned = true;
        console.warn('[easywire] Campuswire feed layout not recognized; easywire is inactive.');
      }
      return;
    }
    ensureToggle(categoryWrap, state);
    const byNumber = new Map(state.posts.map((post) => [post.number, post]));
    for (const item of nativeList.querySelectorAll(SELECTORS.item)) decorateNative(item, byNumber, state);
    renderRoot(nativeList, state);
    const display = state.sorted ? 'none' : '';
    if (nativeList.style.display !== display) nativeList.style.display = display;
  }

  function openPost(number) {
    const nativeList = document.querySelector(SELECTORS.nativeList);
    const items = nativeList ? [...nativeList.querySelectorAll(SELECTORS.item)] : [];
    const native = items.find((item) => {
      const ref = item.querySelector(SELECTORS.ref);
      return postNumberFromRef(ref && ref.textContent) === number;
    });
    if (native) {
      native.click();
      return;
    }
    const slug = groupSlugFromPath(location.pathname);
    if (slug) location.assign(`/c/${slug}/feed/${number}`);
  }

  const api = { SELECTORS, render, openPost, postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireRender = api;
})(globalThis);
