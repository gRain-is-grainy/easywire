(function (root) {
  const SELECTORS = {
    column: '.left-col-2',
    nativeList: '.left-col-2 .posts-list-wrap:not(.ew-root)',
    categoryButton: '.left-col-2 .dropdown-btn-wrapper > button',
    categoryMenu: 'ul.dropdown-menu.categories-list', // Tippy popup, mounted on <body> only while open
    item: '.post-preview-wrapper',
    titleText: '.post-title h3',
    ref: '.post-ref',
    time: '.post-time',
    stats: '.post-preview-stats',
  };
  const RECENT_LABEL = 'Recent activity';
  const ANONYMOUS_IMG = 'https://static.campuswire.com/images/anonymous-img.svg'; // Campuswire's own anonymous icon
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

  function sameTitle(a, b) {
    const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ');
    return norm(a) === norm(b);
  }

  function escapeHtml(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (c) => map[c]);
  }

  function countHtml(count) {
    return `<span class="ew-count"><i class="far fa-comment"></i><span>${Number(count)}</span></span>`;
  }

  function pinHtml(postId, pinned) {
    return `<button type="button" class="ew-pin${pinned ? ' is-pinned' : ''}" data-post-id="${escapeHtml(postId)}" title="${pinned ? 'Unpin' : 'Pin'}"><i class="fas fa-thumbtack"></i></button>`;
  }

  // Same icons Campuswire shows; it has none for unresolved questions.
  function typeIconHtml(post) {
    const icon = (title, name) => `<div class="post-type-icon" title="${title}"><i class="fas ${name}"></i></div>`;
    if (post.note) return icon('This is a note', 'fa-pen');
    if (post.answered) return icon('This question is resolved', 'fa-check');
    return '';
  }

  // Campuswire's avatar markup. Every named user has a photo, so no photo means an anonymous post.
  function avatarHtml(post, status) {
    const name = escapeHtml(post.authorName || '');
    const img = post.authorPhoto
      ? `<img alt="${name}" src="${escapeHtml(post.authorPhoto)}">`
      : `<img alt="Anonymous user" src="${ANONYMOUS_IMG}">`;
    const statusClass = status === 'active' ? 'online' : escapeHtml(status || 'offline'); // same mapping as Campuswire
    return `<div title="${name || 'Anonymous'}"><div class="user-img-wrap"><div class="img-wrap">${img}</div><span class="user-status ${statusClass}"></span></div></div>`;
  }

  function itemHtml(post, view) {
    const number = Number(post.number) || 0;
    const typeIcon = typeIconHtml(post);
    const count = view.count === null ? '' : countHtml(view.count);
    const unread = post.read === false ? ' unread' : ''; // cached posts from before we stored `read` count as read
    return (
      `<div role="button" tabindex="0" class="post-preview-wrapper d-flex align-items-start ew-item${unread}" data-number="${number}">` +
      `${avatarHtml(post, view.status)}<div class="post-preview">` +
      `<div class="post-title d-flex justify-content-between"><h3>${escapeHtml(post.title)}</h3><span class="post-ref">#${number}</span></div>` +
      `<div class="post-text-wrap d-flex justify-content-between align-items-center"><div class="post-text">${escapeHtml(post.body)}</div>${typeIcon}</div>` +
      `<div class="post-preview-footer d-flex align-items-center"><div class="post-time"><span class="post-likes"><i class="far fa-thumbs-up"></i>${Number(post.likesCount) || 0}</span><i class="far fa-clock"></i>${escapeHtml(view.time)}${count}</div><div class="post-preview-stats">${pinHtml(post.id, view.pinned)}</div></div>` +
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
      status: state.presence[post.authorId],
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
    if (!('ewOriginal' in time.dataset)) time.dataset.ewOriginal = node.nodeValue; // for teardown()
    if (node.nodeValue !== text) node.nodeValue = text;
  }

  function setCount(time, count) {
    const existing = time.querySelector(':scope > .ew-count');
    if (count === null) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      time.insertAdjacentHTML('beforeend', countHtml(count));
      return;
    }
    const label = existing.lastElementChild;
    const text = String(count);
    if (label.textContent !== text) label.textContent = text;
  }

  function setPin(stats, postId, pinned) {
    const existing = stats.querySelector(':scope > .ew-pin');
    if (!existing) {
      stats.insertAdjacentHTML('beforeend', pinHtml(postId, pinned));
      const button = stats.lastElementChild;
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

  // Campuswire renders anonymous authors as an <img> with no src (a blank spot); fill in its own anonymous icon.
  function fillAnonymousAvatar(item) {
    const img = item.querySelector('.user-img-wrap img:not([src])');
    if (!img) return;
    img.src = ANONYMOUS_IMG;
    img.dataset.ewAnonymous = ''; // for teardown()
  }

  function decorateNative(item, byNumber, state) {
    fillAnonymousAvatar(item);
    const ref = item.querySelector(SELECTORS.ref);
    const post = byNumber.get(postNumberFromRef(ref && ref.textContent));
    if (!post) return;
    // Post numbers are per class: a title mismatch means our data is for another class, so leave the item alone.
    const titleText = item.querySelector(SELECTORS.titleText);
    if (titleText && !sameTitle(titleText.textContent, post.title)) return;
    const view = viewOf(post, state);
    const time = item.querySelector(SELECTORS.time);
    if (time) {
      if (view.time) setClockText(time, view.time);
      setCount(time, view.count);
    }
    const stats = item.querySelector(SELECTORS.stats);
    if (stats) setPin(stats, post.id, view.pinned);
  }

  // Picking "Recent activity" toggles the sort; picking any Campuswire filter turns it off so that filter applies.
  function onMenuClick(event) {
    const li = event.target.closest('li[data-content]');
    if (!li) return;
    if (!li.classList.contains('ew-recent')) {
      handlers.onSortOff();
      return;
    }
    event.stopPropagation();
    handlers.onToggleSorted();
    const button = document.querySelector(SELECTORS.categoryButton);
    if (button) button.click(); // closes Campuswire's menu
  }

  function ensureMenuItem(state) {
    const menu = document.querySelector(SELECTORS.categoryMenu);
    if (!menu) return;
    let li = menu.querySelector(':scope > .ew-recent');
    if (!li) {
      const html = `<li data-content="true" class="ew-recent"><i class="far fa-clock"></i>${RECENT_LABEL}</li>`;
      const header = menu.querySelector(':scope > .header');
      if (header) header.insertAdjacentHTML('beforebegin', html);
      else menu.insertAdjacentHTML('beforeend', html);
      li = menu.querySelector(':scope > .ew-recent');
      menu.addEventListener('click', onMenuClick, true); // same function, so re-adding is a no-op
    }
    const className = state.sorted ? 'ew-recent is-on' : 'ew-recent';
    if (li.className !== className) li.className = className;
    const title = state.paused
      ? 'Activity data paused (Campuswire refused requests); showing cached data'
      : 'Sort all posts by latest post or reply';
    if (li.title !== title) li.title = title;
  }

  // Shows "Recent activity" on Campuswire's dropdown button while sorted; restores its label otherwise.
  function setCategoryLabel(button, sorted) {
    const node = button.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (sorted) {
      if (!('ewLabel' in button.dataset)) button.dataset.ewLabel = node.nodeValue;
      if (node.nodeValue !== RECENT_LABEL) node.nodeValue = RECENT_LABEL;
    } else if ('ewLabel' in button.dataset) {
      node.nodeValue = button.dataset.ewLabel;
      delete button.dataset.ewLabel;
    }
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

  function onRootKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!event.target.matches('.ew-item, .ew-section')) return;
    event.preventDefault();
    onRootClick(event);
  }

  function rootHtml(state) {
    const { sortByActivity } = root.EasywireActivity;
    const item = (post) => itemHtml(post, viewOf(post, state));
    let html = '';
    const pinned = sortByActivity(state.posts.filter((p) => state.pinnedIds.includes(p.id)), state.summaries);
    if (pinned.length) {
      html += `<div class="filter-by d-flex align-items-center ew-section" role="button" tabindex="0"><i class="fas fa-chevron-${state.collapsed ? 'right' : 'down'}"></i> My pins</div>`;
      if (!state.collapsed) html += pinned.map(item).join('');
    }
    if (state.sorted && state.posts.length) {
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
      rootEl.addEventListener('keydown', onRootKeydown);
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
    const categoryButton = document.querySelector(SELECTORS.categoryButton);
    if (!nativeList || !categoryButton) {
      if (!warned && location.pathname.includes('/feed') && document.querySelector(SELECTORS.column)) {
        warned = true;
        console.warn('[easywire] Campuswire feed layout not recognized; easywire is inactive.');
      }
      return;
    }
    ensureMenuItem(state);
    setCategoryLabel(categoryButton, state.sorted);
    const byNumber = new Map(state.posts.map((post) => [post.number, post]));
    for (const item of nativeList.querySelectorAll(SELECTORS.item)) decorateNative(item, byNumber, state);
    renderRoot(nativeList, state);
    const display = state.sorted && state.posts.length ? 'none' : '';
    if (nativeList.style.display !== display) nativeList.style.display = display;
  }

  // Undo everything render() added so the page looks like plain Campuswire.
  function teardown() {
    for (const el of document.querySelectorAll('.ew-root, .ew-recent, .ew-pin, .ew-count')) el.remove();
    const categoryButton = document.querySelector(SELECTORS.categoryButton);
    if (categoryButton) setCategoryLabel(categoryButton, false);
    for (const time of document.querySelectorAll('[data-ew-original]')) {
      setClockText(time, time.dataset.ewOriginal);
      delete time.dataset.ewOriginal;
    }
    for (const img of document.querySelectorAll('img[data-ew-anonymous]')) {
      img.removeAttribute('src');
      delete img.dataset.ewAnonymous;
    }
    const nativeList = document.querySelector(SELECTORS.nativeList);
    if (nativeList) nativeList.style.display = '';
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

  const api = { SELECTORS, ANONYMOUS_IMG, render, teardown, openPost, postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml, sameTitle };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireRender = api;
})(globalThis);
