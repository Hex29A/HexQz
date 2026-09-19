import { Router } from 'express';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import db from '../db/db.js';
import { closeQuestion, getAnswerCount } from '../engine.js';

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

// Participant auth (issue #8): participant.id is public (shown on screens,
// used as React keys); the secret is handed out once at registration and is
// required to answer or to join the socket room as that participant.
export function authenticateParticipant(participantId, secret) {
  if (!participantId || typeof secret !== 'string' || !secret) return null;
  const p = db.prepare('SELECT * FROM participant WHERE id = ?').get(participantId);
  if (!p || !p.secret) return null;
  const a = Buffer.from(p.secret), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return p;
}

// Check if a participant still exists (used by JoinView auto-resume)
router.get('/session/:sessionId/participant/:participantId', (req, res) => {
  const p = authenticateParticipant(req.params.participantId, req.headers['x-participant-secret']);
  if (!p || p.session_id !== req.params.sessionId) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Register participant
router.post('/join/:joinCode/register', (req, res) => {
  const joinCode = req.params.joinCode.toUpperCase();
  const session = db.prepare('SELECT * FROM session WHERE join_code = ?').get(joinCode);

  if (!session) return res.status(404).json({ error: 'Invalid join code' });
  if (session.status === 'finished') return res.status(410).json({ error: 'This quiz has ended' });

  const { displayName, teamName } = req.body;
  if (typeof displayName !== 'string' || !displayName.trim()) return res.status(400).json({ error: 'Display name is required' });
  if (displayName.trim().length > 30) return res.status(400).json({ error: 'Name too long (max 30)' });
  if (teamName !== undefined && teamName !== null && typeof teamName !== 'string') return res.status(400).json({ error: 'Invalid team name' });
  if (teamName && teamName.trim().length > 30) return res.status(400).json({ error: 'Team name too long (max 30)' });

  // Check if name is already taken in this session
  const existing = db.prepare('SELECT id FROM participant WHERE session_id = ? AND display_name = ?').get(session.id, displayName.trim());
  if (existing) {
    // Never hand out the existing participant's id (issue #8); resume works
    // through the secret stored in the original browser.
    return res.status(409).json({ error: 'Name already taken' });
  }

  const participantId = randomUUID();
  const participantSecret = randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO participant (id, session_id, display_name, team_name, secret)
    VALUES (?, ?, ?, ?, ?)
  `).run(participantId, session.id, displayName.trim(), teamName?.trim() || null, participantSecret);

  // Broadcast to session room (no ids — other players don't need them)
  const io = req.app.get('io');
  io.to(`session:${session.id}`).emit('session:participant_joined', {
    displayName: displayName.trim(),
    teamName: teamName?.trim() || null
  });

  res.status(201).json({ participantId, participantSecret, sessionId: session.id });
});

// Submit answer
router.post('/answer', (req, res) => {
  const { participantId, participantSecret, questionId, answerId, textAnswer } = req.body;

  if (typeof participantId !== 'string' || typeof questionId !== 'string') {
    return res.status(400).json({ error: 'participantId and questionId are required' });
  }
  if (answerId !== undefined && answerId !== null) {
    const ids = Array.isArray(answerId) ? answerId : [answerId];
    if (ids.length > 20 || !ids.every(id => typeof id === 'string' && id.length <= 64)) {
      return res.status(400).json({ error: 'Invalid answerId' });
    }
  }
  if (textAnswer !== undefined && textAnswer !== null && typeof textAnswer !== 'string' && typeof textAnswer !== 'object') {
    return res.status(400).json({ error: 'Invalid textAnswer' });
  }

  // Validate participant (id + secret, issue #8)
  const participant = authenticateParticipant(participantId, participantSecret);
  if (!participant) return res.status(403).json({ error: 'Invalid participant credentials' });

  // Validate question belongs to the session's quiz
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(participant.session_id);
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const question = db.prepare('SELECT * FROM question WHERE id = ? AND quiz_id = ?').get(questionId, session.quiz_id);
  if (!question) return res.status(404).json({ error: 'Question not found' });

  // Only the question that is currently open accepts answers
  const questions = db.prepare('SELECT id FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  if (session.status !== 'active' || session.current_phase !== 'question' || questions[session.current_question_index]?.id !== questionId) {
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

  // Check for existing response (allow revision). A revised answer is scored
  // on the time of the revision, never on the earlier attempt (issue #9).
  const existing = db.prepare('SELECT id, points_awarded FROM response WHERE participant_id = ? AND question_id = ?').get(participantId, questionId);

  // Validate textAnswer length (multi_part sends a small JSON object/string)
  const textLen = typeof textAnswer === 'string' ? textAnswer.length : (textAnswer ? JSON.stringify(textAnswer).length : 0);
  if (textLen > (question.type === 'multi_part' ? 1000 : 100)) {
    return res.status(400).json({ error: 'Answer too long' });
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

  // Save or update response.
  // multiple_choice keeps its selected IDs in their own JSON column instead
  // of comma-joined into text_answer (issue #27) — a free_text answer that
  // happens to contain a comma used to be ambiguous with that encoding.
  const isMultipleChoice = question.type === 'multiple_choice';
  const storedAnswerId = isMultipleChoice ? null : (Array.isArray(answerId) ? answerId[0] : (answerId || null));
  const storedSelectedIds = isMultipleChoice && Array.isArray(answerId) ? JSON.stringify(answerId) : null;
  const storedTextAnswer = isMultipleChoice
    ? null
    : (typeof textAnswer === 'object' ? JSON.stringify(textAnswer) : (textAnswer || null));

  // Response + score update happen together: a crash between them must not
  // leave a scored answer with no recorded response, or vice versa (issue #27).
  const saveResponse = db.transaction(() => {
    if (existing) {
      const oldPoints = existing.points_awarded || 0;
      db.prepare(`
        UPDATE response SET answer_id = ?, text_answer = ?, selected_answer_ids = ?, is_correct = ?, points_awarded = ?, response_time_ms = ?, answered_at = unixepoch()
        WHERE id = ?
      `).run(storedAnswerId, storedTextAnswer, storedSelectedIds, isCorrect, points, responseTimeMs, existing.id);

      const pointsDiff = points - oldPoints;
      if (pointsDiff !== 0 && question.type !== 'estimation') {
        db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(pointsDiff, participantId);
      }
    } else {
      const responseId = randomUUID();
      db.prepare(`
        INSERT INTO response (id, participant_id, question_id, answer_id, text_answer, selected_answer_ids, is_correct, points_awarded, response_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(responseId, participantId, questionId, storedAnswerId, storedTextAnswer, storedSelectedIds, isCorrect, points, responseTimeMs);

      if (points > 0 && question.type !== 'estimation') {
        db.prepare('UPDATE participant SET score = score + ? WHERE id = ?').run(points, participantId);
      }
    }
  });
  saveResponse();

  // Emit answer count to session
  const io = req.app.get('io');
  const answerCount = getAnswerCount(questionId, session.id);
  io.to(`session:${session.id}`).emit('session:answer_count', { questionIndex: session.current_question_index, ...answerCount });

  // Everyone answered: close early
  if (answerCount.total > 0 && answerCount.count === answerCount.total) {
    console.log(`[EARLY-CLOSE] All ${answerCount.total} players answered question ${questionId}`);
    setImmediate(() => closeQuestion(session.id));
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
    SELECT r.id, r.text_answer, r.answer_id, r.selected_answer_ids, r.is_correct, r.points_awarded, r.reviewed,
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
    } else if (r.selected_answer_ids) {
      const ids = JSON.parse(r.selected_answer_ids);
      answerText = ids.map(id => answerMap[id] || id).join(', ');
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

  // Same scale as normal scoring (issue #19): speed-based out of 1000 when the
  // session is timed, flat 1 point when untimed.
  const oldPoints = response.points_awarded || 0;
  const newPoints = isCorrect
    ? (session.answer_time_seconds
        ? calculateSpeedPoints(1000, response.response_time_ms, session.answer_time_seconds)
        : 1)
    : 0;
  const pointsDiff = newPoints - oldPoints;

  db.transaction(() => {
    db.prepare('UPDATE response SET is_correct = ?, points_awarded = ?, reviewed = 1 WHERE id = ?')
      .run(isCorrect ? 1 : 0, newPoints, responseId);

    if (pointsDiff !== 0) {
      db.prepare('UPDATE participant SET score = score + ? WHERE id = ?')
        .run(pointsDiff, response.participant_id);
    }
  })();

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
