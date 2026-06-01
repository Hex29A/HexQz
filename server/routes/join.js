import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';
import { executeQuestionClose } from './session.js';

const router = Router();

// Calculate points based on response time
// basePoints: maximum points (e.g., 1000)
// responseTimeMs: time taken to answer in milliseconds
// maxTimeSeconds: maximum allowed time to answer
function calculateSpeedPoints(basePoints, responseTimeMs, maxTimeSeconds = 30) {
  if (!responseTimeMs || responseTimeMs < 0) return basePoints;
  
  const maxTimeMs = maxTimeSeconds * 1000;
  if (responseTimeMs >= maxTimeMs) return 0; // Too slow, no points
  
  // Linear decay: 100% points at 0ms, 0% at maxTime
  // Points = basePoints * (1 - (timeElapsed / maxTime))
  const timeRatio = responseTimeMs / maxTimeMs;
  const multiplier = Math.max(0, 1 - timeRatio);
  
  return Math.round(basePoints * multiplier);
}

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
    SELECT s.*, q.title, q.theme_color, q.light_mode, q.logo_url FROM session s
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
    lightMode: !!session.light_mode,
    logoUrl: session.logo_url
  });
});

// Check if a participant still exists (used by JoinView auto-resume)
router.get('/session/:sessionId/participant/:participantId', (req, res) => {
  const p = db.prepare('SELECT id FROM participant WHERE id = ? AND session_id = ?').get(req.params.participantId, req.params.sessionId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
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

  // Check if name is already taken in this session
  const existing = db.prepare('SELECT id FROM participant WHERE session_id = ? AND display_name = ?').get(session.id, displayName.trim());
  if (existing) {
    return res.status(409).json({ error: 'Name already taken', participantId: existing.id, sessionId: session.id });
  }

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
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(questionId, session.quiz_id);
  if (!question) return res.status(404).json({ error: 'Question not found' });

  // Check current question matches (rejects closed/past questions)
  const questions = db.prepare('SELECT id FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  if (questions[session.current_question_index]?.id !== questionId) {
    return res.status(410).json({ error: 'Question is closed' });
  }

  // Calculate response time (ms since question started)
  let responseTimeMs = null;
  if (session.question_started_at) {
    responseTimeMs = Date.now() - (session.question_started_at * 1000);
    // Ensure valid response time (positive and reasonable)
    if (responseTimeMs < 0) responseTimeMs = 0;
    if (responseTimeMs > 999999) responseTimeMs = null; // Over 16 minutes, likely error
  }

  // Check for existing response (allow revision)
  const existing = db.prepare('SELECT id, points_awarded, response_time_ms FROM response WHERE participant_id = ? AND question_id = ?').get(participantId, questionId);

  // Use the fastest response time if revising
  if (existing && existing.response_time_ms && responseTimeMs) {
    responseTimeMs = Math.min(responseTimeMs, existing.response_time_ms);
  }

  // Validate textAnswer length
  if (textAnswer && textAnswer.length > 100) {
    return res.status(400).json({ error: 'Answer too long (max 100)' });
  }

  // Determine correctness
  let isCorrect = 0;
  let points = 0;
  const isTimed = !!session.answer_time_seconds;
  const basePoints = isTimed ? 1000 : 1; // Speed-based scoring when timed, 1pt per correct when untimed
  const speedMaxTime = session.answer_time_seconds || 30;

  // Scoring helper: speed-based when timed, flat 1pt when untimed
  const awardPoints = (responseTimeMs) => {
    return isTimed ? calculateSpeedPoints(basePoints, responseTimeMs, speedMaxTime) : 1;
  };

  if (question.type === 'single_choice' || question.type === 'true_false') {
    if (answerId) {
      const answer = db.prepare('SELECT * FROM answer WHERE id = ? AND question_id = ?').get(answerId, questionId);
      if (answer && answer.is_correct) {
        isCorrect = 1;
        points = awardPoints(responseTimeMs);
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
        points = awardPoints(responseTimeMs);
      }
    }
  } else if (question.type === 'free_text') {
    if (textAnswer) {
      const correctAnswers = db.prepare('SELECT text FROM answer WHERE question_id = ? AND is_correct = 1').all(questionId);
      const match = correctAnswers.some(a => a.text.toLowerCase().trim() === textAnswer.toLowerCase().trim());
      if (match) {
        isCorrect = 1;
        points = awardPoints(responseTimeMs);
      }
    }
  } else if (question.type === 'numeric') {
    if (textAnswer !== undefined && textAnswer !== null) {
      const num = parseFloat(textAnswer);
      if (!isNaN(num) && Math.abs(num - question.correct_value) <= question.tolerance) {
        isCorrect = 1;
        points = awardPoints(responseTimeMs);
      }
    }
  }
  // estimation: scored later when admin advances
  // multi_part: scored per part
  if (question.type === 'multi_part') {
    if (textAnswer) {
      // textAnswer is JSON: {"Artist": "ABBA", "Song": "Dancing Queen"}
      let parts;
      try { parts = typeof textAnswer === 'string' ? JSON.parse(textAnswer) : textAnswer; } catch { parts = {}; }
      const answers = db.prepare('SELECT * FROM answer WHERE question_id = ? AND is_correct = 1').all(questionId);

      // Group accepted answers by part_label
      const partGroups = {};
      for (const a of answers) {
        if (!a.part_label) continue;
        if (!partGroups[a.part_label]) partGroups[a.part_label] = [];
        partGroups[a.part_label].push(a.text.toLowerCase().trim());
      }

      const totalParts = Object.keys(partGroups).length;
      let matchedParts = 0;
      for (const [label, accepted] of Object.entries(partGroups)) {
        const userAnswer = (parts[label] || '').toLowerCase().trim();
        if (userAnswer && accepted.includes(userAnswer)) matchedParts++;
      }

      if (totalParts > 0) {
        if (isTimed) {
          const partialMultiplier = matchedParts / totalParts;
          points = Math.round(calculateSpeedPoints(1000, responseTimeMs, speedMaxTime) * partialMultiplier);
        } else {
          points = matchedParts; // 1pt per correct part in untimed mode
        }
        isCorrect = matchedParts === totalParts ? 1 : 0;
      }
    }
  }

  // Save or update response
  // For multiple_choice, store comma-separated IDs in text_answer (answer_id has FK constraint)
  const isMultipleChoice = question.type === 'multiple_choice';
  const storedAnswerId = isMultipleChoice ? null : (Array.isArray(answerId) ? answerId[0] : (answerId || null));
  const storedTextAnswer = isMultipleChoice && Array.isArray(answerId)
    ? answerId.join(',')
    : (typeof textAnswer === 'object' ? JSON.stringify(textAnswer) : (textAnswer || null));

  if (existing) {
    // Revision: update existing response and adjust score
    const oldPoints = existing.points_awarded || 0;
    db.prepare(`
      UPDATE response SET answer_id = ?, text_answer = ?, is_correct = ?, points_awarded = ?, response_time_ms = ?, answered_at = unixepoch()
      WHERE id = ?
    `).run(storedAnswerId, storedTextAnswer, isCorrect, points, responseTimeMs, existing.id);

    const pointsDiff = points - oldPoints;
    if (pointsDiff !== 0 && question.type !== 'estimation') {
      db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(pointsDiff, participantId);
    }
  } else {
    // New response
    const responseId = randomUUID();
    db.prepare(`
      INSERT INTO response (id, participant_id, question_id, answer_id, text_answer, is_correct, points_awarded, response_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(responseId, participantId, questionId, storedAnswerId, storedTextAnswer, isCorrect, points, responseTimeMs);

    if (points > 0 && question.type !== 'estimation') {
      db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(points, participantId);
    }
  }

  // Emit answer count to session
  const io = req.app.get('io');
  const answered = db.prepare(`
    SELECT p.display_name FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
  `).all(questionId, session.id).map(r => r.display_name);
  const allParticipants = db.prepare('SELECT display_name FROM participant WHERE session_id = ?').all(session.id).map(p => p.display_name);
  const waiting = allParticipants.filter(name => !answered.includes(name));

  io.to(`session:${session.id}`).emit('session:answer_count', {
    questionIndex: session.current_question_index,
    count: answered.length,
    total: allParticipants.length,
    answered,
    waiting
  });

  // Check if all players have answered - trigger early close
  if (answered.length === allParticipants.length && allParticipants.length > 0) {
    console.log(`[EARLY-ADVANCE] All ${allParticipants.length} players answered question ${questionId}, triggering early close`);
    
    // Get scoreboard pause from session settings
    const scoreboardPauseSeconds = session.scoreboard_pause_seconds || 10;
    
    // Trigger immediate close (this will cancel any existing timer via the closedQuestions check)
    setImmediate(() => {
      executeQuestionClose(io, session.id, scoreboardPauseSeconds);
    });
  }

  res.json({ received: true });
});

// Get responses for a question (admin review)
router.get('/session/:sessionId/question/:questionId/responses', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = db.prepare(`
    SELECT s.*, q.admin_token FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!session || session.admin_token !== adminToken) return res.status(403).json({ error: 'Forbidden' });

  const responses = db.prepare(`
    SELECT r.id, r.text_answer, r.answer_id, r.is_correct, r.points_awarded, r.reviewed,
           p.display_name, p.id as participant_id
    FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
    ORDER BY r.answered_at
  `).all(req.params.questionId, req.params.sessionId);

  // Resolve answer_id(s) to text
  const allAnswers = db.prepare('SELECT id, text FROM answer WHERE question_id = ?').all(req.params.questionId);
  const answerMap = Object.fromEntries(allAnswers.map(a => [a.id, a.text]));

  res.json(responses.map(r => {
    let answerText = null;
    if (r.answer_id) {
      answerText = answerMap[r.answer_id] || r.answer_id;
    } else if (r.text_answer && r.text_answer.includes(',')) {
      // multiple_choice: comma-separated answer IDs stored in text_answer
      const ids = r.text_answer.split(',');
      if (ids.every(id => answerMap[id])) {
        answerText = ids.map(id => answerMap[id]).join(', ');
      }
    }
    return {
      id: r.id,
      textAnswer: r.text_answer,
      answerText,
      isCorrect: !!r.is_correct,
      pointsAwarded: r.points_awarded,
      reviewed: !!r.reviewed,
      displayName: r.display_name,
      participantId: r.participant_id
    };
  }));
});

// Admin override: mark a response correct/incorrect
router.post('/session/:sessionId/override', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = db.prepare(`
    SELECT s.*, q.admin_token FROM session s
    JOIN quiz q ON q.id = s.quiz_id
    WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!session || session.admin_token !== adminToken) return res.status(403).json({ error: 'Forbidden' });

  const { responseId, isCorrect } = req.body;
  if (!responseId) return res.status(400).json({ error: 'responseId required' });

  const response = db.prepare(`
    SELECT r.*, p.session_id FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.id = ?
  `).get(responseId);
  if (!response || response.session_id !== session.id) return res.status(404).json({ error: 'Response not found' });

  const oldPoints = response.points_awarded || 0;
  const newPoints = isCorrect ? 10 : 0;
  const pointsDiff = newPoints - oldPoints;

  // Update response
  db.prepare('UPDATE response SET is_correct = ?, points_awarded = ?, reviewed = 1 WHERE id = ?')
    .run(isCorrect ? 1 : 0, newPoints, responseId);

  // Adjust participant score
  if (pointsDiff !== 0) {
    db.prepare('UPDATE participant SET score = score + ? WHERE id = ?')
      .run(pointsDiff, response.participant_id);
  }

  // Broadcast updated scores
  const io = req.app.get('io');
  const scores = db.prepare(`
    SELECT display_name, team_name, score FROM participant
    WHERE session_id = ? ORDER BY score DESC
  `).all(session.id).map(p => ({ name: p.display_name, team: p.team_name, score: p.score }));
  io.to(`session:${session.id}`).emit('session:scores', { scores });

  res.json({ ok: true, pointsDiff });
});

export default router;
