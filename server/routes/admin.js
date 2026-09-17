import { Router } from 'express';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import multer from 'multer';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import rateLimit from 'express-rate-limit';
import db from '../db/db.js';
import { str, hexColor, imageUrl, num, questionType, answerList } from '../validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same directory index.js serves as /uploads. Defaults to <server>/uploads
// (/app/uploads in the image); the old '../../uploads' resolved to /uploads
// in the container, outside the mounted volume, so files vanished on recreate.
export const uploadsDir = process.env.UPLOADS_DIR || join(__dirname, '..', 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, gif, webp'));
    }
  }
});

const router = Router();

// Admin authentication. ADMIN_SECRET is mandatory: without it every admin
// route answers 503 instead of silently being open (issue #10).
// The cookie carries a random session token stored in admin_session, never
// the secret itself (issue #2). The X-Admin-Secret header (scripts/CLI) is
// compared in constant time.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function validSessionToken(token) {
  if (!token) return false;
  const row = db.prepare('SELECT token FROM admin_session WHERE token = ? AND expires_at > unixepoch()').get(token);
  return !!row;
}

function hasAdminSecret(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return validSessionToken(req.cookies.admin_session) || safeEqual(req.headers['x-admin-secret'], secret);
}

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_SECRET) return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  if (!hasAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Brute-force protection on the login form (issue #3). Keyed by client IP;
// app.set('trust proxy', 1) makes that the real IP behind the reverse proxy.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});

router.post('/admin/login', loginLimiter, (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  const { password } = req.body;
  if (!safeEqual(password, secret)) return res.status(401).json({ error: 'Invalid password' });
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_session WHERE expires_at <= unixepoch()').run();
  db.prepare('INSERT INTO admin_session (token, expires_at) VALUES (?, unixepoch() + ?)').run(token, Math.floor(SESSION_TTL_MS / 1000));
  res.cookie('admin_session', token, {
    httpOnly: true,
    secure: req.secure, // true behind the TLS proxy, false on plain http (issue #20)
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  const token = req.cookies.admin_session;
  if (token) db.prepare('DELETE FROM admin_session WHERE token = ?').run(token);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

router.get('/admin/quizzes', requireAdmin, (req, res) => {
  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.admin_token, q.theme_color, q.logo_url, q.created_at, q.archived,
           COUNT(DISTINCT s.id) as session_count
    FROM quiz q
    LEFT JOIN session s ON s.quiz_id = q.id
    GROUP BY q.id
    ORDER BY q.archived ASC, q.created_at DESC
  `).all();
  res.json(quizzes.map(q => {
    const latestSession = db.prepare('SELECT id, status FROM session WHERE quiz_id = ? ORDER BY created_at DESC LIMIT 1').get(q.id);
    return {
      id: q.id, title: q.title, adminToken: q.admin_token, themeColor: q.theme_color,
      logoUrl: q.logo_url, createdAt: q.created_at, sessionCount: q.session_count,
      archived: !!q.archived, latestSessionId: latestSession?.id || null, latestSessionStatus: latestSession?.status || null
    };
  }));
});

router.post('/quiz', requireAdmin, (req, res) => {
  const title = str(req.body.title, { field: 'Title', max: 200, required: true });
  const themeColor = hexColor(req.body.themeColor);
  const logoUrl = imageUrl(req.body.logoUrl, 'logoUrl');
  const id = randomUUID();
  const adminToken = randomUUID();
  db.prepare('INSERT INTO quiz (id, title, admin_token, theme_color, logo_url) VALUES (?, ?, ?, ?, ?)').run(id, title, adminToken, themeColor, logoUrl);
  res.status(201).json({ quizId: id, adminToken });
});

router.get('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(quiz.id);
  const questionsWithAnswers = questions.map(q => {
    const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(q.id);
    return { id: q.id, text: q.text, imageUrl: q.image_url, type: q.type, sortOrder: q.sort_order,
      correctValue: q.correct_value, tolerance: q.tolerance,
      answers: answers.map(a => ({ id: a.id, text: a.text, isCorrect: !!a.is_correct, partLabel: a.part_label })) };
  });
  res.json({ id: quiz.id, title: quiz.title, adminToken: quiz.admin_token, themeColor: quiz.theme_color,
    lightMode: !!quiz.light_mode, logoUrl: quiz.logo_url, createdAt: quiz.created_at, questions: questionsWithAnswers });
});

router.put('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const { lightMode, answerTimeSeconds, scoreboardPauseSeconds } = req.body;
  const title = str(req.body.title, { field: 'Title', max: 200, required: true });
  const themeColor = hexColor(req.body.themeColor);
  const logoUrl = imageUrl(req.body.logoUrl, 'logoUrl');
  const answerTime = answerTimeSeconds !== undefined ? Math.max(5, Math.min(300, parseInt(answerTimeSeconds) || 30)) : quiz.answer_time_seconds;
  const scoreboardPause = scoreboardPauseSeconds !== undefined ? Math.max(3, Math.min(60, parseInt(scoreboardPauseSeconds) || 10)) : quiz.scoreboard_pause_seconds;
  db.prepare('UPDATE quiz SET title = ?, theme_color = ?, logo_url = ?, light_mode = ?, answer_time_seconds = ?, scoreboard_pause_seconds = ? WHERE id = ?').run(title, themeColor, logoUrl, lightMode ? 1 : 0, answerTime, scoreboardPause, quiz.id);
  res.json({ ok: true });
});

router.delete('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  // participants/responses/questions/answers cascade via foreign keys
  db.transaction(() => {
    db.prepare('DELETE FROM session WHERE quiz_id = ?').run(quiz.id);
    db.prepare('DELETE FROM quiz WHERE id = ?').run(quiz.id);
  })();
  res.json({ ok: true });
});

router.post('/quiz/:adminToken/archive', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const archived = quiz.archived ? 0 : 1;
  db.prepare('UPDATE quiz SET archived = ? WHERE id = ?').run(archived, quiz.id);
  res.json({ ok: true, archived });
});

router.delete('/quiz/:adminToken/session/:sessionId', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const session = db.prepare('SELECT * FROM session WHERE id = ? AND quiz_id = ?').get(req.params.sessionId, quiz.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  db.prepare('DELETE FROM session WHERE id = ?').run(session.id); // participants/responses cascade
  res.json({ ok: true });
});

router.post('/quiz/:adminToken/question', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const text = str(req.body.text, { field: 'Question text', max: 1000, required: true });
  const type = questionType(req.body.type);
  const image = imageUrl(req.body.imageUrl, 'imageUrl');
  const correctValue = num(req.body.correctValue, { field: 'correctValue' });
  const tolerance = num(req.body.tolerance, { field: 'tolerance', min: 0 }) ?? 0;
  const answers = answerList(req.body.answers);
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM question WHERE quiz_id = ?').get(quiz.id);
  const sortOrder = (maxOrder?.m ?? -1) + 1;
  const questionId = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO question (id, quiz_id, sort_order, text, image_url, type, correct_value, tolerance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(questionId, quiz.id, sortOrder, text, image, type, correctValue, tolerance);
    const insertAnswer = db.prepare('INSERT INTO answer (id, question_id, text, is_correct, part_label) VALUES (?, ?, ?, ?, ?)');
    for (const a of answers) insertAnswer.run(randomUUID(), questionId, a.text, a.isCorrect, a.partLabel);
  })();
  res.status(201).json({ questionId });
});

router.put('/quiz/:adminToken/question/:questionId', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(req.params.questionId, quiz.id);
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const text = str(req.body.text, { field: 'Question text', max: 1000, required: true });
  const type = questionType(req.body.type, question.type);
  const image = imageUrl(req.body.imageUrl, 'imageUrl');
  const correctValue = num(req.body.correctValue, { field: 'correctValue' });
  const tolerance = num(req.body.tolerance, { field: 'tolerance', min: 0 }) ?? 0;
  const sortOrder = num(req.body.sortOrder, { field: 'sortOrder', integer: true, min: 0 }) ?? question.sort_order;
  const answers = req.body.answers === undefined ? null : answerList(req.body.answers);
  db.transaction(() => {
    db.prepare('UPDATE question SET text = ?, image_url = ?, type = ?, correct_value = ?, tolerance = ?, sort_order = ? WHERE id = ?').run(text, image, type, correctValue, tolerance, sortOrder, question.id);
    if (answers) {
      db.prepare('DELETE FROM answer WHERE question_id = ?').run(question.id);
      const insertAnswer = db.prepare('INSERT INTO answer (id, question_id, text, is_correct, part_label) VALUES (?, ?, ?, ?, ?)');
      for (const a of answers) insertAnswer.run(randomUUID(), question.id, a.text, a.isCorrect, a.partLabel);
    }
  })();
  res.json({ ok: true });
});

router.delete('/quiz/:adminToken/question/:questionId', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(req.params.questionId, quiz.id);
  if (!question) return res.status(404).json({ error: 'Question not found' });
  db.prepare('DELETE FROM question WHERE id = ?').run(question.id);
  res.json({ ok: true });
});

// Upload always requires either the admin session or a valid quiz admin token.
router.post('/upload', (req, res) => {
  if (!hasAdminSecret(req)) {
    const adminToken = req.headers['x-admin-token'];
    const quiz = adminToken ? db.prepare('SELECT id FROM quiz WHERE admin_token = ?').get(adminToken) : null;
    if (!quiz) return res.status(401).json({ error: 'Unauthorized' });
  }
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 10MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

export default router;
