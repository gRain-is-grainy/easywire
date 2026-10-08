(function (root) {
  // True if dotted version `a` is higher than `b`, comparing each part as a number.
  function isNewer(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  const api = { isNewer };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireVersion = api;
})(globalThis);
