"use strict";
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhotoStatus = api;
})(typeof window !== "undefined" ? window : null, function() {
  function calculateMissingPhotos(order = [], photos = {}, thumbnails = {}) {
    return order.filter(id => !photos?.[id] || !thumbnails?.[id]);
  }
  function missingPhotosForManifest(manifest) {
    if (!manifest) return [];
    const order = manifest.order || Object.keys(manifest.students || {});
    if (Array.isArray(manifest.missingPhotos)) {
      const declared = new Set(manifest.missingPhotos);
      return order.filter(id => declared.has(id));
    }
    return calculateMissingPhotos(order, manifest.assets?.photos, manifest.assets?.thumbnails);
  }
  return { calculateMissingPhotos, missingPhotosForManifest };
});
