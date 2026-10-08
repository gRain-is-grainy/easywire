(function (root) {
  const MIN_WIDTH = 260; // narrowest feed where a card's title and #number still read
  const COLUMN = '.left-col-2'; // the feed; its parent <main> also holds the post content
  const FEED_LIST = '.posts-list-wrap';
  let onResize = null;
  let drag = null;

  // The feed never gets wider than the post content beside it, nor narrower than MIN_WIDTH.
  function clampWidth(width, mainWidth) {
    return Math.round(Math.max(MIN_WIDTH, Math.min(width, mainWidth / 2)));
  }

  function setWidth(column, width) {
    const value = `${clampWidth(width, column.parentElement.getBoundingClientRect().width)}px`;
    if (column.style.width !== value) column.style.width = value;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const column = event.currentTarget.parentElement;
    event.preventDefault(); // no text selection while dragging
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { column, startX: event.clientX, startWidth: column.getBoundingClientRect().width };
    document.body.classList.add('ew-resizing');
  }

  function onPointerMove(event) {
    if (!drag) return;
    setWidth(drag.column, drag.startWidth + event.clientX - drag.startX);
  }

  function onPointerUp() {
    if (!drag) return;
    const width = drag.column.getBoundingClientRect().width;
    drag = null;
    document.body.classList.remove('ew-resizing');
    if (onResize) onResize(Math.round(width));
  }

  // Adds the handle on the feed's right edge if Campuswire re-rendered it away, and applies the saved width.
  function apply(width, nextOnResize) {
    onResize = nextOnResize;
    const column = document.querySelector(COLUMN);
    if (!column || !column.querySelector(FEED_LIST)) {
      teardown(); // Campuswire uses the same column for other lists, e.g. DMs
      return;
    }
    if (!column.querySelector(':scope > .ew-resizer')) {
      const handle = document.createElement('div');
      handle.className = 'ew-resizer';
      handle.title = 'Drag to resize';
      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
      column.append(handle);
    }
    if (width && !drag) setWidth(column, width);
  }

  function teardown() {
    drag = null;
    document.body.classList.remove('ew-resizing');
    for (const handle of document.querySelectorAll('.ew-resizer')) handle.remove();
    const column = document.querySelector(COLUMN);
    if (column && column.style.width) column.style.width = '';
  }

  const api = { MIN_WIDTH, clampWidth, apply, teardown };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireResize = api;
})(globalThis);
