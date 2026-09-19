import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';
import { str } from '../validate.js';
import * as engine from '../engine.js';

const router = Router();

function verifyAdminToken(sessionId, adminToken) {
  if (!adminToken) return null;
  const session = db.prepare(`
    SELECT s.*, q.admin_token FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.id = ?
  `).get(sessionId);
  if (!session || session.admin_token !== adminToken) return null;
  return session;
}

// Host actions share the same auth: X-Admin-Token must match the quiz.
function requireHost(req, res, next) {
  const session = verifyAdminToken(req.params.sessionId, req.headers['x-admin-token']);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  req.session = session;
  next();
}

// Create session
router.post('/quiz/:adminToken/session', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const { useTimers, answerTimeSeconds, scoreboardPauseSeconds } = req.body;
  const name = str(req.body.sessionName, { field: 'sessionName', max: 100 });
  const answerTime = useTimers ? Math.max(5, Math.min(300, parseInt(answerTimeSeconds) || 30)) : null;
  const scoreboardPause = Math.max(3, Math.min(60, parseInt(scoreboardPauseSeconds) || 10));

  const sessionId = randomUUID();
  const joinCode = engine.generateJoinCode();
  db.prepare(`
    INSERT INTO session (id, quiz_id, join_code, session_name, answer_time_seconds, scoreboard_pause_seconds, status, current_question_index)
    VALUES (?, ?, ?, ?, ?, ?, 'waiting', 0)
  `).run(sessionId, quiz.id, joinCode, name, answerTime, scoreboardPause);

  res.status(201).json({ sessionId, joinCode, sessionName: name });
});

// List sessions for a quiz
router.get('/quiz/:adminToken/sessions', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quiz WHERE admin_token = ?').get(req.params.adminToken);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const sessions = db.prepare(`
    SELECT s.*, COUNT(p.id) as participant_count,
      (SELECT display_name FROM participant WHERE session_id = s.id ORDER BY score DESC LIMIT 1) as winner_name,
      (SELECT score FROM participant WHERE session_id = s.id ORDER BY score DESC LIMIT 1) as winner_score
    FROM session s
    LEFT JOIN participant p ON p.session_id = s.id
    WHERE s.quiz_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all(quiz.id);

  res.json(sessions.map(s => ({
    id: s.id,
    joinCode: s.join_code,
    sessionName: s.session_name,
    status: s.status,
    currentQuestionIndex: s.current_question_index,
    participantCount: s.participant_count,
    createdAt: s.created_at,
    answerTimeSeconds: s.answer_time_seconds,
    scoreboardPauseSeconds: s.scoreboard_pause_seconds,
    winner: s.status === 'finished' && s.winner_name ? { name: s.winner_name, score: s.winner_score } : null
  })));
});

// Reset a session — clears participants, responses, generates new join code
router.post('/session/:sessionId/reset', requireHost, (req, res) => {
  const joinCode = engine.resetSession(req.session.id);
  console.log(`[RESET] Session ${req.session.id} reset with new join code ${joinCode}`);
  res.json({ ok: true, joinCode });
});

// Start session
router.post('/session/:sessionId/start', requireHost, (req, res) => {
  const error = engine.startSession(req.session.id);
  if (error) return res.status(400).json({ error });
  const state = engine.buildSessionState(req.session.id);
  res.json({ questionIndex: 0, totalQuestions: state.totalQuestions, answerTimeSeconds: state.answerTimeSeconds });
});

// Manual continue to the next question
router.post('/session/:sessionId/continue', requireHost, (req, res) => {
  if (req.session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
  const message = engine.continueSession(req.session.id);
  res.json({ ok: true, ...(message ? { message } : {}) });
});

// Skip the current result phase
router.post('/session/:sessionId/advance-phase', requireHost, (req, res) => {
  if (req.session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
  const error = engine.advancePhase(req.session.id);
  if (error) return res.status(400).json({ error });
  const session = engine.loadSession(req.session.id);
  res.json({ ok: true, phase: session.current_phase });
});

// Manual close question (untimed mode)
router.post('/session/:sessionId/close-question', requireHost, (req, res) => {
  if (req.session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
  if (req.session.current_phase !== 'question') return res.json({ ok: true, message: 'Not in question phase' });
  engine.closeQuestion(req.session.id);
  res.json({ ok: true });
});

// Current session state (public: players poll it)
router.get('/session/:sessionId/current', (req, res) => {
  const state = engine.buildSessionState(req.params.sessionId);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  res.json(state);
});

// Resolve what a response answered, as text, against a pre-fetched
// answerId -> text map so callers don't hit the DB per response (issue #27).
function answerTextFor(resp, answerMap) {
  if (resp.answer_id) return answerMap[resp.answer_id] || null;
  if (resp.selected_answer_ids) {
    return JSON.parse(resp.selected_answer_ids).map(id => answerMap[id]).filter(Boolean).join(', ') || null;
  }
  return resp.text_answer || null;
}

// One query for every response in the session, keyed by participant+question,
// instead of participants x questions round trips (issue #27).
function getResponseMap(sessionId) {
  const rows = db.prepare(`
    SELECT r.* FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE p.session_id = ?
  `).all(sessionId);
  const map = new Map();
  for (const r of rows) map.set(`${r.participant_id}:${r.question_id}`, r);
  return map;
}

function getQuizAnswerMap(quizId) {
  const rows = db.prepare(`
    SELECT a.id, a.text FROM answer a
    JOIN question q ON q.id = a.question_id
    WHERE q.quiz_id = ?
  `).all(quizId);
  return Object.fromEntries(rows.map(a => [a.id, a.text]));
}

// Session results
router.get('/session/:sessionId/results', (req, res) => {
  const session = engine.loadSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const questions = engine.getQuestions(session.quiz_id);
  const participants = db.prepare('SELECT * FROM participant WHERE session_id = ? ORDER BY score DESC').all(session.id);
  const responses = getResponseMap(session.id);
  const answerMap = getQuizAnswerMap(session.quiz_id);

  const breakdown = {};
  for (const p of participants) {
    breakdown[p.display_name] = questions.map(q => {
      const resp = responses.get(`${p.id}:${q.id}`);
      if (!resp) return { question: q.text, answer: null, correct: false, points: 0 };
      return { question: q.text, answer: answerTextFor(resp, answerMap), correct: !!resp.is_correct, points: resp.points_awarded || 0 };
    });
  }

  res.json({
    quizTitle: quiz.title,
    status: session.status,
    scores: engine.getSessionScores(session.id),
    breakdown,
    themeColor: quiz.theme_color,
    lightMode: !!quiz.light_mode,
    logoUrl: quiz.logo_url
  });
});

// Session stats
router.get('/session/:sessionId/stats', (req, res) => {
  const session = engine.loadSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const questions = engine.getQuestions(session.quiz_id);
  const participantCount = db.prepare('SELECT COUNT(*) as c FROM participant WHERE session_id = ?').get(session.id).c;
  const stats = questions.map(q => {
    const s = engine.questionStats(q, session.id);
    return {
      questionId: q.id,
      text: q.text,
      type: q.type,
      responseCount: s.totalCount,
      correctCount: s.correctCount,
      correctPercent: s.totalCount > 0 ? Math.round((s.correctCount / s.totalCount) * 100) : 0
    };
  });
  res.json({ participantCount, stats });
});

// Export CSV
router.get('/session/:sessionId/export', (req, res) => {
  const session = engine.loadSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const participants = db.prepare('SELECT * FROM participant WHERE session_id = ? ORDER BY score DESC').all(session.id);
  const questions = engine.getQuestions(session.quiz_id);
  const responses = getResponseMap(session.id);
  const answerMap = getQuizAnswerMap(session.quiz_id);

  // CSV cells: quote everything, double inner quotes, and neutralise formula
  // injection (cells starting with = + - @ or tab/CR) with a leading quote (issue #11).
  const cell = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };

  let csv = 'Rank,Name,Team,Score';
  for (const q of questions) csv += ',' + cell(`Q${q.sort_order + 1}: ${q.text}`);
  csv += '\n';

  participants.forEach((p, idx) => {
    csv += `${idx + 1},${cell(p.display_name)},${cell(p.team_name)},${p.score}`;
    for (const q of questions) {
      const resp = responses.get(`${p.id}:${q.id}`);
      csv += resp ? ',' + cell(`${resp.is_correct ? '✓' : '✗'} ${answerTextFor(resp, answerMap) || ''}`) : ',""';
    }
    csv += '\n';
  });

  const safeName = quiz.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'quiz';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-results.csv"`);
  res.send('﻿' + csv);
});

export default router;
