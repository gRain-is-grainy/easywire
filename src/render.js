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
  const EXPORT_LABEL = 'Export';
  const ANONYMOUS_IMG = 'https://static.campuswire.com/images/anonymous-img.svg'; // Campuswire's own anonymous icon
  let handlers = null;
  let warned = false;
  let selecting = false; // mirrors state.selecting for the document-level handlers below
  let selectedIds = []; // mirrors state.selectedIds, the base a drag starts from
  let copying = false; // mirrors Boolean(state.selectStatus)
  let drag = null; // the drag-select in progress
  let swallowClick = false;
  const DRAG_EDGE = 40; // px from the feed's top or bottom where a drag auto-scrolls
  const DRAG_SPEED = 20; // px per frame at the very edge
  const DRAG_SLOP = 5; // px the pointer may wander during a plain click

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

  // Campuswire's own checkbox. Out of the tab order: the card itself is the control while selecting.
  function selectHtml(post, selected) {
    const id = escapeHtml(post.id);
    return `<div class="custom-control custom-checkbox ew-select"><input type="checkbox" class="custom-control-input" tabindex="-1" data-post-id="${id}" aria-label="Select post #${Number(post.number) || 0}"${selected ? ' checked' : ''}><label class="custom-control-label"></label></div>`;
  }

  const plural = (count) => `${count} post${count === 1 ? '' : 's'}`;

  function selectBarHtml({ count, status }) {
    return (
      '<div class="ew-select-bar d-flex align-items-center">' +
      `<span class="ew-select-count">${count} selected</span>` +
      '<button type="button" class="btn btn-outline ew-select-cancel">Cancel</button>' +
      `<button type="button" class="btn btn-primary ew-select-copy"${count ? '' : ' disabled'}>${escapeHtml(status || `Copy ${plural(count)}`)}</button>` +
      '</div>'
    );
  }

  // Built once per opening; only the count line and the Export all button change afterwards, so typing a date isn't interrupted.
  const EXPORT_MODAL_HTML =
    '<div class="modal-backdrop show"></div>' +
    '<div class="modal show ew-export-modal" role="dialog" aria-modal="true" aria-labelledby="ew-export-title" tabindex="-1">' +
    '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
    '<div class="modal-header d-flex justify-content-between"><h5 class="modal-title" id="ew-export-title">Export posts</h5>' +
    '<button type="button" class="icon-btn ew-export-close" aria-label="Close"><i class="fas fa-times"></i></button></div>' +
    '<div class="modal-body"><div class="ew-export-label">Published between (optional)</div>' +
    '<div class="ew-export-dates d-flex align-items-center">' +
    '<input type="date" class="form-control" id="ew-export-from" aria-label="From date">' +
    '<span>and</span>' +
    '<input type="date" class="form-control" id="ew-export-to" aria-label="To date">' +
    '</div><div class="ew-export-count" aria-live="polite"></div></div>' +
    '<div class="modal-footer d-flex justify-content-end">' +
    '<button type="button" class="btn btn-outline ew-export-select">Select posts</button>' +
    '<button type="button" class="btn btn-primary ew-export-all"></button>' +
    '</div></div></div></div>';

  function exportModalView({ total, matching, invalid, status }) {
    return {
      countText: invalid ? 'Start date is after end date' : `${matching} of ${plural(total)}`,
      allLabel: status || (matching ? `Export all ${matching}` : 'No posts in range'),
      allDisabled: Boolean(status) || !matching,
    };
  }

  // Same icons Campuswire shows; it has none for unresolved questions.
  function typeIconHtml(post) {
    const icon = (title, name) => `<div class="post-type-icon" title="${title}"><i class="fas ${name}"></i></div>`;
    if (post.note) return icon('This is a note', 'fa-pen');
    if (post.answered) return icon('This question is resolved', 'fa-check');
    return '';
  }

  // Campuswire's avatar markup. Every named user has a photo, so no photo means an anonymous post.
  function avatarHtml(post, status, extra = '') {
    const name = escapeHtml(post.authorName || '');
    const img = post.authorPhoto
      ? `<img alt="${name}" src="${escapeHtml(post.authorPhoto)}">`
      : `<img alt="Anonymous user" src="${ANONYMOUS_IMG}">`;
    const statusClass = status === 'active' ? 'online' : escapeHtml(status || 'offline'); // same mapping as Campuswire
    return `<div title="${name || 'Anonymous'}"><div class="user-img-wrap"><div class="img-wrap">${img}</div><span class="user-status ${statusClass}"></span></div>${extra}</div>`;
  }

  function itemHtml(post, view) {
    const number = Number(post.number) || 0;
    const typeIcon = typeIconHtml(post);
    const count = view.count === null ? '' : countHtml(view.count);
    const unread = view.unread ? ' unread' : '';
    const selected = view.selecting && view.selected ? ' ew-selected' : '';
    const badge = view.badge ? `<div class="unread-badge">${escapeHtml(view.badge)}</div>` : '';
    return (
      `<div role="button" tabindex="0" class="post-preview-wrapper d-flex align-items-start ew-item${unread}${selected}" data-number="${number}">` +
      `${avatarHtml(post, view.status, view.selecting ? selectHtml(post, view.selected) : '')}<div class="post-preview">` +
      `<div class="post-title d-flex justify-content-between"><h3>${escapeHtml(post.title)}</h3><span class="post-ref">#${number}</span></div>` +
      `<div class="post-text-wrap d-flex justify-content-between align-items-center"><div class="post-text">${escapeHtml(post.body)}</div>${typeIcon}</div>` +
      `<div class="post-preview-footer d-flex align-items-center"><div class="post-time"><span class="post-likes"><i class="far fa-thumbs-up"></i>${Number(post.likesCount) || 0}</span><i class="far fa-clock"></i>${escapeHtml(view.time)}${count}</div><div class="post-preview-stats">${badge}${view.selecting ? '' : pinHtml(post.id, view.pinned)}</div></div>` +
      '</div></div>'
    );
  }

  // Campuswire's own card for the post is always current; without one, use our fetched data and its socket snapshot.
  function unreadOf(post, state) {
    const live = state.native.get(post.id);
    if (live) return live;
    const count = state.unreadCounts[post.conversationId] || 0;
    return {
      unread: post.read === false, // cached posts from before we stored `read` count as read
      badge: count > 0 ? (count <= 99 ? String(count) : '99+') : '', // same cap as Campuswire's badge
    };
  }

  function viewOf(post, state) {
    const { activityOf, formatRelative } = root.EasywireActivity;
    const summary = state.summaries[post.id];
    return {
      ...unreadOf(post, state),
      time: formatRelative(activityOf(post, state.summaries), state.now),
      count: summary ? summary.replyCount : null,
      pinned: state.pinnedIds.includes(post.id),
      status: state.presence[post.authorId],
      selecting: state.selecting,
      selected: state.selectedIds.includes(post.id),
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

  // The box sits under the avatar, in the card's first child.
  function setSelect(item, post, selected) {
    let box = item.firstElementChild.querySelector(':scope > .ew-select');
    if (!box) {
      item.firstElementChild.insertAdjacentHTML('beforeend', selectHtml(post, selected));
      box = item.firstElementChild.lastElementChild;
    }
    const input = box.querySelector('input');
    if (input.checked !== selected) input.checked = selected;
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
    const badge = item.querySelector(`${SELECTORS.stats} > .unread-badge`);
    state.native.set(post.id, { unread: item.classList.contains('unread'), badge: badge ? badge.textContent : '' });
    const view = viewOf(post, state);
    const time = item.querySelector(SELECTORS.time);
    if (time) {
      if (view.time) setClockText(time, view.time);
      setCount(time, view.count);
    }
    const stats = item.querySelector(SELECTORS.stats);
    if (view.selecting) {
      const pin = stats && stats.querySelector(':scope > .ew-pin');
      if (pin) pin.remove();
      if (item.firstElementChild) setSelect(item, post, view.selected);
    } else {
      const box = item.querySelector('.ew-select');
      if (box) box.remove();
      if (stats) setPin(stats, post.id, view.pinned);
    }
    const tinted = Boolean(view.selecting && view.selected);
    if (item.classList.contains('ew-selected') !== tinted) item.classList.toggle('ew-selected', tinted);
  }

  // While selecting, Campuswire's own card toggles instead of opening the post (opening would mark it viewed).
  function onNativeCard(event) {
    if (!selecting || !(event.target instanceof Element)) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest(`${SELECTORS.nativeList} ${SELECTORS.item}`);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const box = item.querySelector('.ew-select [data-post-id]');
    if (box) handlers.onToggleSelect(box.dataset.postId);
  }

  // Always recomputed from the selection at mousedown, so shrinking the range restores what was outside it.
  function dragSelection(baseIds, rangeIds, mode) {
    if (mode === 'deselect') return baseIds.filter((id) => !rangeIds.includes(id));
    return [...new Set([...baseIds, ...rangeIds])];
  }

  const DRAG_CARDS = `${SELECTORS.nativeList} ${SELECTORS.item}, .ew-root .ew-item`;
  const idOf = (card) => card.querySelector('.ew-select [data-post-id]')?.dataset.postId;
  const listCards = (list) => [...list.querySelectorAll(SELECTORS.item)].filter(idOf);

  function cardAt(el) {
    const card = el instanceof Element ? el.closest(DRAG_CARDS) : null;
    return card && idOf(card) ? card : null;
  }

  const edgeSpeed = (distance) => (distance < DRAG_EDGE ? Math.ceil(DRAG_SPEED * Math.min(1, (DRAG_EDGE - distance) / DRAG_EDGE)) : 0);

  // Scrolls when near the feed's top or bottom, then sets every card between the start card and the one under the pointer.
  function stepDrag(scroll) {
    if (!drag.list.isConnected) return endDrag(); // Campuswire replaced the list
    // Until the pointer really moves, it's a press for a plain click: don't scroll it away from the card.
    if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) <= DRAG_SLOP) return;
    const scroller = drag.list.parentElement;
    const rect = scroller.getBoundingClientRect();
    const dock = scroller.querySelector(':scope > .ew-select-dock');
    const top = dock ? Math.max(rect.top, dock.getBoundingClientRect().bottom) : rect.top; // the sticky bar covers the feed's top
    if (scroll) scroller.scrollTop += edgeSpeed(rect.bottom - drag.y) - edgeSpeed(drag.y - top);
    // Past an edge (or over the bar) the card at the edge counts, so the range keeps growing while it scrolls.
    const card = cardAt(document.elementFromPoint(drag.x, Math.min(Math.max(drag.y, top), rect.bottom - 1)));
    if (!card || !drag.list.contains(card)) return;
    const cards = listCards(drag.list); // re-queried: .ew-root re-renders on every selection change
    const index = cards.indexOf(card);
    if (index === drag.index) return;
    drag.index = index;
    drag.moved = true;
    const range = cards.slice(Math.min(index, drag.start), Math.max(index, drag.start) + 1);
    handlers.onSetSelection(dragSelection(drag.base, range.map(idOf), drag.mode));
  }

  function onDragFrame() {
    stepDrag(true);
    if (drag) drag.frame = requestAnimationFrame(onDragFrame);
  }

  function onDragMove(event) {
    if (!(event.buttons & 1)) return onDragEnd(event); // the mouseup was lost (e.g. released outside the window)
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function onDragEnd(event) {
    const current = drag; // stepDrag may end the drag
    current.x = event.clientX;
    current.y = event.clientY;
    stepDrag(false);
    if (current.moved) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false));
    }
    endDrag();
  }

  function endDrag() {
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    window.removeEventListener('blur', endDrag);
    drag = null;
  }

  // Press on a card and drag across others to select (or deselect, if it started selected) the whole run.
  function onDragStart(event) {
    swallowClick = false;
    if (!selecting || copying || event.button !== 0 || drag) return;
    const card = cardAt(event.target);
    if (!card) return;
    event.preventDefault(); // no text selection; Campuswire's cards have no mousedown handlers
    const list = card.closest('.posts-list-wrap');
    const start = listCards(list).indexOf(card);
    const mode = selectedIds.includes(idOf(card)) ? 'deselect' : 'select';
    const { clientX: x, clientY: y } = event;
    drag = { list, start, index: start, base: selectedIds, mode, x, y, startX: x, startY: y, moved: false };
    drag.frame = requestAnimationFrame(onDragFrame);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    window.addEventListener('blur', endDrag);
  }

  // A drag ends with a click on whatever was under the pointer; it must never reach Campuswire or toggle a card.
  function onClickAfterDrag(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function closeMenu() {
    const button = document.querySelector(SELECTORS.categoryButton);
    if (button) button.click(); // closes Campuswire's menu
  }

  // Picking "Recent activity" toggles the sort; picking any Campuswire filter turns it off so that filter applies.
  function onMenuClick(event) {
    const li = event.target.closest('li[data-content]');
    if (!li) return;
    if (li.classList.contains('ew-export')) {
      event.stopPropagation(); // keep the menu open so the "Copied" label shows
      if (!handlers.onExport()) closeMenu(); // opening the modal: get the menu out of the way
      return;
    }
    if (!li.classList.contains('ew-recent')) {
      handlers.onSortOff();
      return;
    }
    event.stopPropagation();
    handlers.onToggleSorted();
    closeMenu();
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

    let exportLi = menu.querySelector(':scope > .ew-export');
    if (!exportLi) {
      li.insertAdjacentHTML('afterend', '<li data-content="true" class="ew-export" title="Copy posts and their replies as text"><i class="far fa-copy"></i><span></span></li>');
      exportLi = li.nextElementSibling;
    }
    const label = exportLi.lastElementChild;
    const text = state.exportStatus || EXPORT_LABEL;
    if (label.textContent !== text) label.textContent = text;
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
    if (event.target.closest('.ew-section')) {
      handlers.onToggleCollapsed();
      return;
    }
    const item = event.target.closest('.ew-item');
    if (selecting) {
      const box = item && item.querySelector('.ew-select [data-post-id]');
      if (box) {
        event.preventDefault(); // the label/checkbox must not toggle itself; render does it
        handlers.onToggleSelect(box.dataset.postId);
      }
      return;
    }
    const pin = event.target.closest('.ew-pin');
    if (pin) {
      handlers.onTogglePin(pin.dataset.postId);
      return;
    }
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

  function onDockClick(event) {
    event.stopPropagation();
    if (event.target.closest('.ew-select-cancel')) handlers.onCancelSelect();
    else if (event.target.closest('.ew-select-copy')) handlers.onCopySelected();
  }

  // The bar sits in the scroller itself (not .ew-root, which is short and may be hidden) so it can stick to the top.
  function renderDock(rootEl, state) {
    let dock = rootEl.parentElement.querySelector(':scope > .ew-select-dock');
    if (!state.selecting) {
      if (dock) dock.remove();
      return;
    }
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'ew-select-dock';
      dock.addEventListener('click', onDockClick);
    }
    if (dock.nextElementSibling !== rootEl) rootEl.before(dock);
    const count = root.EasywireExport.filterPosts(state.posts, { selectedIds: state.selectedIds }).length; // deleted posts drop out
    const html = selectBarHtml({ count, status: state.selectStatus });
    if (dock.ewHtml !== html) {
      dock.innerHTML = html;
      dock.ewHtml = html;
    }
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
      // The swap destroys the focused card; restore focus by index (a post can appear in both My pins and the list).
      const focusIndex = rootEl.contains(document.activeElement)
        ? [...rootEl.querySelectorAll('[tabindex="0"]')].indexOf(document.activeElement)
        : -1;
      rootEl.innerHTML = html;
      rootEl.ewHtml = html;
      if (focusIndex >= 0) rootEl.querySelectorAll('[tabindex="0"]')[focusIndex]?.focus();
    }
    if (rootEl.hidden !== !html) rootEl.hidden = !html;
    renderDock(rootEl, state);
  }

  function onModalClick(event) {
    if (event.target.closest('.ew-export-close') || event.target.classList.contains('ew-export-modal')) handlers.onCloseExport();
    else if (event.target.closest('.ew-export-select')) handlers.onStartSelect();
    else if (event.target.closest('.ew-export-all')) handlers.onExportAll();
  }

  function onModalInput(event) {
    const dialog = event.currentTarget;
    handlers.onExportDates(dialog.querySelector('#ew-export-from').value, dialog.querySelector('#ew-export-to').value);
  }

  function onModalKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation(); // don't let Campuswire act on it too
    handlers.onCloseExport();
  }

  // Appended to <body> like Campuswire's own modals. The dates are written once on open and never re-rendered.
  function renderExportModal(state) {
    let dialog = document.querySelector('body > .ew-export-dialog');
    if (!state.exportModal) {
      if (dialog) {
        dialog.remove();
        const button = document.querySelector(SELECTORS.categoryButton);
        if (button) button.focus();
      }
      return;
    }
    const { from, to, status } = state.exportModal;
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.className = 'ew-export-dialog';
      dialog.innerHTML = EXPORT_MODAL_HTML;
      dialog.querySelector('#ew-export-from').value = from;
      dialog.querySelector('#ew-export-to').value = to;
      dialog.addEventListener('click', onModalClick);
      dialog.addEventListener('input', onModalInput);
      dialog.addEventListener('keydown', onModalKeydown);
      document.body.append(dialog);
      dialog.querySelector('#ew-export-from').focus();
    }
    const matching = root.EasywireExport.filterPosts(state.posts, { from, to }).length;
    const view = exportModalView({ total: state.posts.length, matching, invalid: Boolean(from && to && from > to), status });
    const count = dialog.querySelector('.ew-export-count');
    if (count.textContent !== view.countText) count.textContent = view.countText;
    const all = dialog.querySelector('.ew-export-all');
    if (all.textContent !== view.allLabel) all.textContent = view.allLabel;
    if (all.disabled !== view.allDisabled) all.disabled = view.allDisabled;
  }

  function render(state, nextHandlers) {
    handlers = nextHandlers;
    renderExportModal(state); // before the layout check: the dialog is on <body> and must close even if the feed is gone
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
    selecting = state.selecting;
    selectedIds = state.selectedIds;
    copying = Boolean(state.selectStatus);
    if (!selecting && drag) {
      // Its mouseup comes later, with selection mode off: keep the swallow armed until that click or the next mousedown.
      if (drag.moved) swallowClick = true;
      endDrag();
    }
    document.addEventListener('click', onNativeCard, true); // same function, so re-adding is a no-op
    document.addEventListener('keydown', onNativeCard, true);
    document.addEventListener('mousedown', onDragStart, true);
    window.addEventListener('click', onClickAfterDrag, true); // window capture runs before anything else
    setCategoryLabel(categoryButton, state.sorted);
    const byNumber = new Map(state.posts.map((post) => [post.number, post]));
    const live = { ...state, native: new Map() }; // native: post id -> unread dot and badge on Campuswire's own card
    for (const item of nativeList.querySelectorAll(SELECTORS.item)) decorateNative(item, byNumber, live);
    renderRoot(nativeList, live);
    const display = state.sorted && state.posts.length ? 'none' : '';
    if (nativeList.style.display !== display) nativeList.style.display = display;
  }

  // Undo everything render() added so the page looks like plain Campuswire.
  function teardown() {
    for (const el of document.querySelectorAll('.ew-root, .ew-select-dock, .ew-recent, .ew-export, .ew-pin, .ew-count, .ew-select, .ew-export-dialog')) el.remove();
    for (const item of document.querySelectorAll('.ew-selected')) item.classList.remove('ew-selected');
    selecting = false;
    endDrag();
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

  const api = { SELECTORS, ANONYMOUS_IMG, render, teardown, openPost, postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml, sameTitle, unreadOf, selectHtml, selectBarHtml, exportModalView, EXPORT_MODAL_HTML, dragSelection };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireRender = api;
})(globalThis);
