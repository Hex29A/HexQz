import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';

const router = Router();

// In-memory tracking of closed questions
const closedQuestions = new Map(); // questionId -> timestamp

function generateJoinCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function verifyAdminToken(sessionId, adminToken) {
  const session = db.prepare(`
    SELECT s.*, q.admin_token FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.id = ?
  `).get(sessionId);
  if (!session) return null;
  if (session.admin_token !== adminToken) return null;
  return session;
}

// Create session
router.post('/quiz/:adminToken/session', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  // Check for existing active/waiting session
  const existing = db.prepare('SELECT id, join_code FROM session WHERE quiz_id = ? AND status IN (?, ?)').get(quiz.id, 'waiting', 'active');
  if (existing) {
    return res.status(409).json({ error: 'Quiz already has an active session', sessionId: existing.id, joinCode: existing.join_code });
  }

  // Generate unique join code
  let joinCode;
  let attempts = 0;
  do {
    joinCode = generateJoinCode();
    attempts++;
    if (attempts > 100) return res.status(500).json({ error: 'Could not generate unique join code' });
  } while (db.prepare('SELECT id FROM session WHERE join_code = ?').get(joinCode));

  const sessionId = randomUUID();
  db.prepare(`
    INSERT INTO session (id, quiz_id, join_code, status, current_question_index)
    VALUES (?, ?, ?, 'waiting', 0)
  `).run(sessionId, quiz.id, joinCode);

  res.status(201).json({ sessionId, joinCode });
});

// End/abandon a session
router.post('/session/:sessionId/end', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = db.prepare(`
    SELECT s.*, q.admin_token FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!session || session.admin_token !== adminToken) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('UPDATE session SET status = ? WHERE id = ?').run('finished', session.id);

  const io = req.app.get('io');
  const scores = db.prepare(`
    SELECT display_name, team_name, score FROM participant
    WHERE session_id = ? ORDER BY score DESC
  `).all(session.id).map(p => ({ name: p.display_name, team: p.team_name, score: p.score }));
  io.to(`session:${session.id}`).emit('session:finished', { results: scores, resultsUrl: `/results/${session.id}` });

  res.json({ ok: true });
});

// List sessions for a quiz
router.get('/quiz/:adminToken/sessions', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const sessions = db.prepare(`
    SELECT s.*, COUNT(p.id) as participant_count
    FROM session s
    LEFT JOIN participant p ON p.session_id = s.id
    WHERE s.quiz_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all(quiz.id);

  res.json(sessions.map(s => {
    let winner = null;
    if (s.status === 'finished') {
      const top = db.prepare('SELECT display_name, score FROM participant WHERE session_id = ? ORDER BY score DESC LIMIT 1').get(s.id);
      if (top) winner = { name: top.display_name, score: top.score };
    }
    return {
      id: s.id,
      joinCode: s.join_code,
      status: s.status,
      currentQuestionIndex: s.current_question_index,
      participantCount: s.participant_count,
      createdAt: s.created_at,
      winner
    };
  }));
});

// Start session
router.post('/session/:sessionId/start', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'waiting') return res.status(400).json({ error: 'Session already started' });

  db.prepare('UPDATE session SET status = ? WHERE id = ?').run('active', session.id);

  // Get first question
  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);

  if (questions.length === 0) return res.status(400).json({ error: 'Quiz has no questions' });

  const firstQuestion = questions[0];
  const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(firstQuestion.id);

  const payload = {
    question: { id: firstQuestion.id, text: firstQuestion.text, imageUrl: firstQuestion.image_url, type: firstQuestion.type },
    answers: answers.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined })),
    questionIndex: 0,
    totalQuestions: questions.length
  };

  // Emit via io (attached to req.app)
  const io = req.app.get('io');
  io.to(`session:${session.id}`).emit('session:started', payload);

  res.json(payload);
});

// Advance to next question
router.post('/session/:sessionId/next', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });

  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);

  const currentIndex = session.current_question_index;

  // Close current question
  if (currentIndex < questions.length) {
    const currentQuestion = questions[currentIndex];
    closedQuestions.set(currentQuestion.id, Date.now());

    // Score estimation questions
    if (currentQuestion.type === 'estimation' && currentQuestion.correct_value !== null) {
      scoreEstimationQuestion(currentQuestion);
    }
  }

  // Broadcast scores after closing the question
  const scores = getSessionScores(session.id);
  const io = req.app.get('io');
  io.to(`session:${session.id}`).emit('session:scores', { scores });

  const nextIndex = currentIndex + 1;

  if (nextIndex >= questions.length) {
    // Quiz finished
    db.prepare('UPDATE session SET status = ?, current_question_index = ? WHERE id = ?')
      .run('finished', nextIndex, session.id);

    io.to(`session:${session.id}`).emit('session:finished', {
      results: scores,
      resultsUrl: `/results/${session.id}`
    });

    return res.json({ finished: true, results: scores });
  }

  // Advance
  db.prepare('UPDATE session SET current_question_index = ? WHERE id = ?').run(nextIndex, session.id);

  const nextQuestion = questions[nextIndex];
  const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(nextQuestion.id);

  const payload = {
    question: { id: nextQuestion.id, text: nextQuestion.text, imageUrl: nextQuestion.image_url, type: nextQuestion.type },
    answers: answers.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined })),
    questionIndex: nextIndex,
    totalQuestions: questions.length
  };

  io.to(`session:${session.id}`).emit('session:question', payload);

  res.json(payload);
});

// Get current session state
router.get('/session/:sessionId/current', (req, res) => {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const quiz = db.prepare('SELECT theme_color, light_mode FROM quiz WHERE id = ?').get(session.quiz_id);
  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);

  const scores = getSessionScores(session.id);
  const themeColor = quiz?.theme_color || null;
  const lightMode = !!quiz?.light_mode;

  if (session.status === 'waiting') {
    const participants = db.prepare('SELECT * FROM participant WHERE session_id = ?').all(session.id);
    return res.json({
      status: 'waiting',
      joinCode: session.join_code,
      questionIndex: 0,
      totalQuestions: questions.length,
      scores,
      themeColor,
      lightMode,
      participants: participants.map(p => ({ id: p.id, displayName: p.display_name, teamName: p.team_name }))
    });
  }

  if (session.status === 'finished') {
    return res.json({
      status: 'finished',
      scores,
      themeColor,
      lightMode,
      totalQuestions: questions.length,
      questionIndex: questions.length,
      questions: questions.map(q => ({ id: q.id, text: q.text, type: q.type, sortOrder: q.sort_order }))
    });
  }

  // Active
  const currentQuestion = questions[session.current_question_index];
  if (!currentQuestion) return res.json({ status: 'active', joinCode: session.join_code, scores, themeColor, lightMode, questionIndex: session.current_question_index, totalQuestions: questions.length });

  const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(currentQuestion.id);

  res.json({
    status: 'active',
    joinCode: session.join_code,
    question: { id: currentQuestion.id, text: currentQuestion.text, imageUrl: currentQuestion.image_url, type: currentQuestion.type },
    answers: answers.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined })),
    questionIndex: session.current_question_index,
    totalQuestions: questions.length,
    themeColor,
    lightMode,
    scores
  });
});

// Get session results
router.get('/session/:sessionId/results', (req, res) => {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const scores = getSessionScores(session.id);
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);

  res.json({
    quizTitle: quiz.title,
    status: session.status,
    scores,
    themeColor: quiz.theme_color,
    logoUrl: quiz.logo_url
  });
});

// Session stats
router.get('/session/:sessionId/stats', (req, res) => {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  const participantCount = db.prepare('SELECT COUNT(*) as c FROM participant WHERE session_id = ?').get(session.id).c;

  const stats = questions.map(q => {
    const responses = db.prepare('SELECT * FROM response r JOIN participant p ON p.id = r.participant_id WHERE r.question_id = ? AND p.session_id = ?').all(q.id, session.id);
    const correct = responses.filter(r => r.is_correct).length;
    return {
      questionId: q.id,
      text: q.text,
      type: q.type,
      responseCount: responses.length,
      correctCount: correct,
      correctPercent: responses.length > 0 ? Math.round((correct / responses.length) * 100) : 0
    };
  });

  res.json({ participantCount, stats });
});

// Export CSV
router.get('/session/:sessionId/export', (req, res) => {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const participants = db.prepare('SELECT * FROM participant WHERE session_id = ? ORDER BY score DESC').all(session.id);
  const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);

  let csv = 'Rank,Name,Team,Score';
  for (const q of questions) {
    csv += `,"Q${q.sort_order + 1}: ${q.text.replace(/"/g, '""')}"`;
  }
  csv += '\n';

  participants.forEach((p, idx) => {
    csv += `${idx + 1},"${p.display_name}","${p.team_name || ''}",${p.score}`;
    for (const q of questions) {
      const resp = db.prepare('SELECT * FROM response WHERE participant_id = ? AND question_id = ?').get(p.id, q.id);
      if (resp) {
        const answerText = resp.answer_id
          ? db.prepare('SELECT text FROM answer WHERE id = ?').get(resp.answer_id)?.text || ''
          : resp.text_answer || '';
        csv += `,"${resp.is_correct ? '✓' : '✗'} ${answerText.replace(/"/g, '""')}"`;
      } else {
        csv += ',""';
      }
    }
    csv += '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${quiz.title}-results.csv"`);
  res.send(csv);
});

// --- Helper functions ---

function getSessionScores(sessionId) {
  const participants = db.prepare(`
    SELECT display_name, team_name, score FROM participant
    WHERE session_id = ?
    ORDER BY score DESC
  `).all(sessionId);

  return participants.map(p => ({
    name: p.display_name,
    team: p.team_name,
    score: p.score
  }));
}

function scoreEstimationQuestion(question) {
  const responses = db.prepare(`
    SELECT r.*, p.id as pid FROM response r
    JOIN participant p ON p.id = r.participant_id
    JOIN session s ON s.id = p.session_id
    JOIN question q ON q.quiz_id = s.quiz_id
    WHERE r.question_id = ? AND r.text_answer IS NOT NULL
  `).all(question.id);

  if (responses.length === 0) return;

  // Rank by proximity
  const ranked = responses
    .map(r => ({ ...r, distance: Math.abs(parseFloat(r.text_answer) - question.correct_value) }))
    .sort((a, b) => a.distance - b.distance);

  const pointsTable = [10, 8, 6, 5, 4];

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    let points = i < pointsTable.length ? pointsTable[i] : 2;
    if (r.distance === 0) points += 2; // exact match bonus

    db.prepare('UPDATE response SET is_correct = ? WHERE id = ?').run(points > 0 ? 1 : 0, r.id);
    db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(points, r.participant_id);
  }
}

export default router;
