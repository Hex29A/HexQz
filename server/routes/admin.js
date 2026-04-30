import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';

const router = Router();

// --- Master admin dashboard ---

router.post('/admin/login', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(404).json({ error: 'Dashboard disabled' });

  const { password } = req.body;
  if (!password || password !== secret) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.cookie('admin_session', secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24h
  });
  res.json({ ok: true });
});

router.get('/admin/quizzes', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(404).json({ error: 'Dashboard disabled' });
  if (req.cookies.admin_session !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.admin_token, q.theme_color, q.logo_url, q.created_at,
           COUNT(DISTINCT s.id) as session_count
    FROM quiz q
    LEFT JOIN session s ON s.quiz_id = q.id
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `).all();

  res.json(quizzes.map(q => ({
    id: q.id,
    title: q.title,
    adminToken: q.admin_token,
    themeColor: q.theme_color,
    logoUrl: q.logo_url,
    createdAt: q.created_at,
    sessionCount: q.session_count
  })));
});

// --- Quiz CRUD ---

router.post('/quiz', (req, res) => {
  // Require admin session to create quizzes
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.cookies.admin_session !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, themeColor, logoUrl } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (title.trim().length > 200) return res.status(400).json({ error: 'Title too long (max 200)' });

  const id = randomUUID();
  const adminToken = randomUUID();

  db.prepare(`
    INSERT INTO quiz (id, title, admin_token, theme_color, logo_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title.trim(), adminToken, themeColor || '#6366f1', logoUrl || null);

  res.status(201).json({ quizId: id, adminToken });
});

router.get('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(quiz.id);

  const questionsWithAnswers = questions.map(q => {
    const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(q.id);
    return {
      id: q.id,
      text: q.text,
      imageUrl: q.image_url,
      type: q.type,
      sortOrder: q.sort_order,
      correctValue: q.correct_value,
      tolerance: q.tolerance,
      answers: answers.map(a => ({
        id: a.id,
        text: a.text,
        isCorrect: !!a.is_correct
      }))
    };
  });

  res.json({
    id: quiz.id,
    title: quiz.title,
    adminToken: quiz.admin_token,
    themeColor: quiz.theme_color,
    logoUrl: quiz.logo_url,
    createdAt: quiz.created_at,
    questions: questionsWithAnswers
  });
});

router.put('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const { title, themeColor, logoUrl } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (title.trim().length > 200) return res.status(400).json({ error: 'Title too long (max 200)' });

  db.prepare(`
    UPDATE quiz SET title = ?, theme_color = ?, logo_url = ? WHERE id = ?
  `).run(title.trim(), themeColor || '#6366f1', logoUrl || null, quiz.id);

  res.json({ ok: true });
});

router.delete('/quiz/:adminToken', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  db.prepare('DELETE FROM quiz WHERE id = ?').run(quiz.id);
  res.json({ ok: true });
});

// --- Questions ---

router.post('/quiz/:adminToken/question', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const { text, imageUrl, type, answers, correctValue, tolerance } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Question text is required' });
  if (text.trim().length > 1000) return res.status(400).json({ error: 'Question too long (max 1000)' });

  const validTypes = ['single_choice', 'multiple_choice', 'true_false', 'free_text', 'numeric', 'estimation'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid question type' });

  // Get next sort order
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM question WHERE quiz_id = ?').get(quiz.id);
  const sortOrder = (maxOrder?.m ?? -1) + 1;

  const questionId = randomUUID();
  db.prepare(`
    INSERT INTO question (id, quiz_id, sort_order, text, image_url, type, correct_value, tolerance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(questionId, quiz.id, sortOrder, text.trim(), imageUrl || null, type, correctValue ?? null, tolerance ?? 0);

  // Insert answers
  if (answers && Array.isArray(answers)) {
    const insertAnswer = db.prepare('INSERT INTO answer (id, question_id, text, is_correct) VALUES (?, ?, ?, ?)');
    for (const a of answers) {
      if (!a.text || !a.text.trim()) continue;
      if (a.text.trim().length > 500) continue;
      insertAnswer.run(randomUUID(), questionId, a.text.trim(), a.isCorrect ? 1 : 0);
    }
  }

  res.status(201).json({ questionId });
});

router.put('/quiz/:adminToken/question/:questionId', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(req.params.questionId, quiz.id);
  if (!question) return res.status(404).json({ error: 'Question not found' });

  const { text, imageUrl, type, answers, correctValue, tolerance, sortOrder } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Question text is required' });
  if (text.trim().length > 1000) return res.status(400).json({ error: 'Question too long (max 1000)' });

  db.prepare(`
    UPDATE question SET text = ?, image_url = ?, type = ?, correct_value = ?, tolerance = ?, sort_order = ?
    WHERE id = ?
  `).run(text.trim(), imageUrl || null, type || question.type, correctValue ?? null, tolerance ?? 0, sortOrder ?? question.sort_order, question.id);

  // Replace answers if provided
  if (answers && Array.isArray(answers)) {
    db.prepare('DELETE FROM answer WHERE question_id = ?').run(question.id);
    const insertAnswer = db.prepare('INSERT INTO answer (id, question_id, text, is_correct) VALUES (?, ?, ?, ?)');
    for (const a of answers) {
      if (!a.text || !a.text.trim()) continue;
      if (a.text.trim().length > 500) continue;
      insertAnswer.run(randomUUID(), question.id, a.text.trim(), a.isCorrect ? 1 : 0);
    }
  }

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

export default router;
