import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';
import { closedQuestions } from './session.js';

const router = Router();

// Platform status
router.get('/status', (req, res) => {
  const sessions = db.prepare(`
    SELECT s.join_code, s.status, q.title as quiz_title, COUNT(p.id) as participant_count
    FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    LEFT JOIN participant p ON p.session_id = s.id
    WHERE s.status IN ('waiting', 'active')
    GROUP BY s.id
  `).all();

  res.json({
    active: sessions.length > 0,
    sessions: sessions.map(s => ({
      joinCode: s.join_code,
      quizTitle: s.quiz_title,
      status: s.status,
      participantCount: s.participant_count
    }))
  });
});

// Validate join code
router.get('/join/:joinCode', (req, res) => {
  const joinCode = req.params.joinCode.toUpperCase();
  const session = db.prepare(`
    SELECT s.*, q.title, q.theme_color, q.logo_url FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.join_code = ?
  `).get(joinCode);

  if (!session) return res.status(404).json({ error: 'Invalid join code' });
  if (session.status === 'finished') return res.status(410).json({ error: 'This quiz has ended' });

  res.json({
    sessionId: session.id,
    quizTitle: session.title,
    status: session.status,
    themeColor: session.theme_color,
    logoUrl: session.logo_url
  });
});

// Register participant
router.post('/join/:joinCode/register', (req, res) => {
  const joinCode = req.params.joinCode.toUpperCase();
  const session = db.prepare('SELECT * FROM session WHERE join_code = ?').get(joinCode);

  if (!session) return res.status(404).json({ error: 'Invalid join code' });
  if (session.status === 'finished') return res.status(410).json({ error: 'This quiz has ended' });

  const { displayName, teamName } = req.body;
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Display name is required' });
  if (displayName.trim().length > 30) return res.status(400).json({ error: 'Name too long (max 30)' });
  if (teamName && teamName.trim().length > 30) return res.status(400).json({ error: 'Team name too long (max 30)' });

  const participantId = randomUUID();
  db.prepare(`
    INSERT INTO participant (id, session_id, display_name, team_name)
    VALUES (?, ?, ?, ?)
  `).run(participantId, session.id, displayName.trim(), teamName?.trim() || null);

  // Broadcast to session room
  const io = req.app.get('io');
  io.to(`session:${session.id}`).emit('session:participant_joined', {
    participantId,
    displayName: displayName.trim(),
    teamName: teamName?.trim() || null
  });

  res.status(201).json({ participantId, sessionId: session.id });
});

// Submit answer
router.post('/answer', (req, res) => {
  const { participantId, questionId, answerId, textAnswer } = req.body;

  if (!participantId || !questionId) {
    return res.status(400).json({ error: 'participantId and questionId are required' });
  }

  // Validate participant
  const participant = db.prepare('SELECT * FROM participant WHERE id = ?').get(participantId);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  // Validate question belongs to the session's quiz
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(participant.session_id);
  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(questionId, session.quiz_id);
  if (!question) return res.status(404).json({ error: 'Question not found' });

  // Check if question is closed
  if (closedQuestions.has(questionId)) {
    return res.status(410).json({ error: 'Question is closed' });
  }

  // Check current question matches
  const questions = db.prepare('SELECT id FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  if (questions[session.current_question_index]?.id !== questionId) {
    return res.status(410).json({ error: 'Question is not current' });
  }

  // Check duplicate
  const existing = db.prepare('SELECT id FROM response WHERE participant_id = ? AND question_id = ?').get(participantId, questionId);
  if (existing) return res.status(409).json({ error: 'Already answered' });

  // Validate textAnswer length
  if (textAnswer && textAnswer.length > 100) {
    return res.status(400).json({ error: 'Answer too long (max 100)' });
  }

  // Determine correctness
  let isCorrect = 0;
  let points = 0;

  if (question.type === 'single_choice' || question.type === 'true_false') {
    if (answerId) {
      const answer = db.prepare('SELECT * FROM answer WHERE id = ? AND question_id = ?').get(answerId, questionId);
      if (answer && answer.is_correct) {
        isCorrect = 1;
        points = 10;
      }
    }
  } else if (question.type === 'multiple_choice') {
    // For multiple choice, answerId could be comma-separated
    if (answerId) {
      const selectedIds = Array.isArray(answerId) ? answerId : [answerId];
      const correctAnswers = db.prepare('SELECT id FROM answer WHERE question_id = ? AND is_correct = 1').all(questionId);
      const correctIds = new Set(correctAnswers.map(a => a.id));
      const selectedSet = new Set(selectedIds);
      if (correctIds.size === selectedSet.size && [...correctIds].every(id => selectedSet.has(id))) {
        isCorrect = 1;
        points = 10;
      }
    }
  } else if (question.type === 'free_text') {
    if (textAnswer) {
      const correctAnswers = db.prepare('SELECT text FROM answer WHERE question_id = ? AND is_correct = 1').all(questionId);
      const match = correctAnswers.some(a => a.text.toLowerCase().trim() === textAnswer.toLowerCase().trim());
      if (match) {
        isCorrect = 1;
        points = 10;
      }
    }
  } else if (question.type === 'numeric') {
    if (textAnswer !== undefined && textAnswer !== null) {
      const num = parseFloat(textAnswer);
      if (!isNaN(num) && Math.abs(num - question.correct_value) <= question.tolerance) {
        isCorrect = 1;
        points = 10;
      }
    }
  }
  // estimation: scored later when admin advances

  // Save response
  const responseId = randomUUID();
  db.prepare(`
    INSERT INTO response (id, participant_id, question_id, answer_id, text_answer, is_correct)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(responseId, participantId, questionId, answerId || null, textAnswer || null, isCorrect);

  // Update score (not for estimation — scored later)
  if (points > 0 && question.type !== 'estimation') {
    db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(points, participantId);
  }

  // Emit answer count to host
  const io = req.app.get('io');
  const answerCount = db.prepare(`
    SELECT COUNT(*) as c FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
  `).get(questionId, session.id).c;
  const totalParticipants = db.prepare('SELECT COUNT(*) as c FROM participant WHERE session_id = ?').get(session.id).c;

  io.to(`session:${session.id}`).emit('session:answer_count', {
    questionIndex: session.current_question_index,
    count: answerCount,
    total: totalParticipants
  });

  res.json({ received: true });
});

export default router;
