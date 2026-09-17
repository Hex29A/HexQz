// Small request-body validators (issue #12). Each returns the cleaned value
// or throws a ValidationError that routes turn into a 400.
export class ValidationError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export function str(value, { field, max, required = false, trim = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const v = trim ? value.trim() : value;
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (max && v.length > max) throw new ValidationError(`${field} too long (max ${max})`);
  return v || null;
}

export function hexColor(value, fallback = '#6366f1') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new ValidationError('Invalid color (expected #rrggbb)');
  return value.toLowerCase();
}

// Uploaded images (/uploads/...) or absolute http(s) URLs only — never javascript: etc.
export function imageUrl(value, field = 'url') {
  const v = str(value, { field, max: 500 });
  if (v === null) return null;
  if (v.startsWith('/uploads/') && !v.includes('..')) return v;
  let u;
  try { u = new URL(v); } catch { throw new ValidationError(`${field} must be an http(s) URL or an uploaded image`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ValidationError(`${field} must be an http(s) URL`);
  return v;
}

export function num(value, { field, allowNull = true, integer = false, min, max } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be an integer`);
  if (min !== undefined && n < min) throw new ValidationError(`${field} must be >= ${min}`);
  if (max !== undefined && n > max) throw new ValidationError(`${field} must be <= ${max}`);
  return n;
}

export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'free_text', 'numeric', 'estimation', 'multi_part'];

export function questionType(value, fallback) {
  if ((value === undefined || value === null) && fallback) return fallback;
  if (!QUESTION_TYPES.includes(value)) throw new ValidationError('Invalid question type');
  return value;
}

export function answerList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('answers must be an array');
  if (value.length > 20) throw new ValidationError('Too many answers (max 20)');
  return value
    .map(a => {
      if (!a || typeof a !== 'object') throw new ValidationError('Invalid answer');
      const text = str(a.text, { field: 'answer text', max: 300 });
      if (!text) return null;
      return { text, isCorrect: a.isCorrect ? 1 : 0, partLabel: str(a.partLabel, { field: 'partLabel', max: 50 }) };
    })
    .filter(Boolean);
}

// Express error handler: turns ValidationError into 400 JSON.
export function validationErrorHandler(err, req, res, next) {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  next(err);
}
