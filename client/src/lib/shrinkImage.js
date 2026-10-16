// Shrink an image in the browser before upload: guests load it on phones over
// party wifi, and a few MB per image slows both the lobby and speed-scored
// questions. GIFs (animation) and files already small enough pass through.
const MAX_SIDE = 1920;
const SMALL_ENOUGH = 600 * 1024;

export async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH) { bitmap.close?.(); return file; }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  // WebP keeps transparency (logos); JPEG is only safe for sources without it.
  const toBlob = (type) => new Promise(r => canvas.toBlob(r, type, 0.85));
  let blob = await toBlob('image/webp');
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    if (file.type !== 'image/jpeg') return file;
    blob = await toBlob('image/jpeg');
    ext = 'jpg';
  }
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
  return new File([blob], name, { type: blob.type });
}
