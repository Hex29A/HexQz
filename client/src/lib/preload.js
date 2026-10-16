// Fetch an image ahead of time so it is already cached when the question shows.
const seen = new Set();
export function preloadImage(url) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  const img = new Image();
  img.src = url;
}
