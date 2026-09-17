import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/db.js';
import { str } from '../validate.js';

const router = Router();

// In-memory tracking of closed questions (per session for cleanup)
const closedQuestions = new Map(); // sessionId -> Set of questionIds
const autoCloseTimeouts = new Map(); // sessionId -> timeoutId
const phaseTransitionTimeouts = new Map(); // sessionId -> [timeoutId, ...]
const getReadyTimeouts = new Map(); // sessionId -> timeoutId

function markQuestionClosed(sessionId, questionId) {
  if (!closedQuestions.has(sessionId)) closedQuestions.set(sessionId, new Set());
  closedQuestions.get(sessionId).add(questionId);
}

function isQuestionClosed(sessionId, questionId) {
  return closedQuestions.has(sessionId) && closedQuestions.get(sessionId).has(questionId);
}

function cleanupSession(sessionId) {
  clearAllSessionTimeouts(sessionId);
  closedQuestions.delete(sessionId);
}

function clearPhaseTimeouts(sessionId) {
  const timeouts = phaseTransitionTimeouts.get(sessionId);
  if (timeouts) {
    for (const t of timeouts) clearTimeout(t);
    phaseTransitionTimeouts.delete(sessionId);
    console.log(`[PHASE-CLEAR] Cleared ${timeouts.length} pending phase timeouts for session ${sessionId}`);
  }
}

function clearAllSessionTimeouts(sessionId) {
  // Clear phase transition timeouts
  clearPhaseTimeouts(sessionId);
  // Clear auto-close timeout
  if (autoCloseTimeouts.has(sessionId)) {
    clearTimeout(autoCloseTimeouts.get(sessionId));
    autoCloseTimeouts.delete(sessionId);
    console.log(`[TIMEOUT-CLEAR] Cleared auto-close timeout for session ${sessionId}`);
  }
  // Clear get-ready timeout
  if (getReadyTimeouts.has(sessionId)) {
    clearTimeout(getReadyTimeouts.get(sessionId));
    getReadyTimeouts.delete(sessionId);
    console.log(`[TIMEOUT-CLEAR] Cleared get-ready timeout for session ${sessionId}`);
  }
}

function addPhaseTimeout(sessionId, fn, delay) {
  const id = setTimeout(fn, delay);
  if (!phaseTransitionTimeouts.has(sessionId)) phaseTransitionTimeouts.set(sessionId, []);
  phaseTransitionTimeouts.get(sessionId).push(id);
  return id;
}

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

  const { useTimers, answerTimeSeconds, scoreboardPauseSeconds } = req.body;
  const name = str(req.body.sessionName, { field: 'sessionName', max: 100 });
  const answerTime = useTimers ? Math.max(5, Math.min(300, parseInt(answerTimeSeconds) || 30)) : null;
  const scoreboardPause = Math.max(3, Math.min(60, parseInt(scoreboardPauseSeconds) || 10));

  // Generate unique join code (multiple sessions allowed)
  let joinCode;
  let attempts = 0;
  do {
    joinCode = generateJoinCode();
    attempts++;
    if (attempts > 100) return res.status(500).json({ error: 'Could not generate unique join code' });
  } while (db.prepare('SELECT id FROM session WHERE join_code = ?').get(joinCode));

  const sessionId = randomUUID();
  db.prepare(`
    INSERT INTO session (id, quiz_id, join_code, session_name, answer_time_seconds, scoreboard_pause_seconds, status, current_question_index)
    VALUES (?, ?, ?, ?, ?, ?, 'waiting', 0)
  `).run(sessionId, quiz.id, joinCode, name, answerTime, scoreboardPause);

  res.status(201).json({ sessionId, joinCode, sessionName: name });
});

// Reset a session — clears participants, responses, generates new join code
router.post('/session/:sessionId/reset', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const io = req.app.get('io');

  // Notify connected clients that session is being reset
  io.to(`session:${session.id}`).emit('session:reset');

  // Clear all timeouts
  cleanupSession(session.id);

  // Delete participants (responses cascade)
  db.prepare('DELETE FROM participant WHERE session_id = ?').run(session.id);

  // Generate new join code
  let joinCode;
  let attempts = 0;
  do {
    joinCode = generateJoinCode();
    attempts++;
    if (attempts > 100) return res.status(500).json({ error: 'Could not generate unique join code' });
  } while (db.prepare('SELECT id FROM session WHERE join_code = ?').get(joinCode));

  // Reset session state
  db.prepare(`
    UPDATE session 
    SET status = 'waiting', current_question_index = 0, auto_mode = 0, 
        question_started_at = NULL, current_phase = 'waiting', join_code = ?
    WHERE id = ?
  `).run(joinCode, session.id);

  console.log(`[RESET] Session ${session.id} reset with new join code ${joinCode}`);

  res.json({ ok: true, joinCode });
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
      sessionName: s.session_name,
      status: s.status,
      currentQuestionIndex: s.current_question_index,
      participantCount: s.participant_count,
      createdAt: s.created_at,
      answerTimeSeconds: s.answer_time_seconds,
      scoreboardPauseSeconds: s.scoreboard_pause_seconds,
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
  
  // Allow restart if session is in get_ready phase or if it's active but still at question 0
  // (handles cases where start was attempted but didn't complete)
  if (session.status === 'active' && session.current_phase !== 'get_ready' && session.current_question_index > 0) {
    return res.status(400).json({ error: 'Session already started' });
  }
  if (session.status === 'finished') {
    return res.status(400).json({ error: 'Session already finished' });
  }

  // Set status to active and phase to get_ready (auto mode was removed, #28)
  db.prepare('UPDATE session SET status = ?, auto_mode = 0, current_phase = ? WHERE id = ?')
    .run('active', 'get_ready', session.id);

  // Get questions
  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);

  if (questions.length === 0) return res.status(400).json({ error: 'Quiz has no questions' });

  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const io = req.app.get('io');

  // Timer settings from session (null = untimed/manual)
  const answerTimeSecs = session.answer_time_seconds;
  const scoreboardPauseSecs = session.scoreboard_pause_seconds || 10;

  // Clear any stale timeouts from previous runs
  clearAllSessionTimeouts(session.id);

  // Show "Get Ready" screen
  const getReadyStartedAt = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE session SET current_phase = ?, question_started_at = ? WHERE id = ?').run('get_ready', getReadyStartedAt, session.id);
  io.to(`session:${session.id}`).emit('session:get_ready', { 
    countdown: 5,
    getReadyStartedAt,
    nextQuestionIndex: 0,
    totalQuestions: questions.length
  });
  
  // After 5 seconds, show the first question (tracked timeout)
  const getReadyId = setTimeout(() => {
    getReadyTimeouts.delete(session.id);
    advanceToNextQuestion(io, session.id, 0, questions, quiz);
    
    // Schedule auto-close (only if timed)
    if (answerTimeSecs) {
      scheduleAutoClose(io, session.id, answerTimeSecs, scoreboardPauseSecs);
    }
  }, 5000);
  getReadyTimeouts.set(session.id, getReadyId);

  res.json({
    questionIndex: 0,
    totalQuestions: questions.length,
    answerTimeSeconds: answerTimeSecs
  });
});

// Manual continue from scoreboard
router.post('/session/:sessionId/continue', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) return res.status(401).json({ error: 'Missing X-Admin-Token header' });

  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });

  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);

  // Handle phase gracefully instead of strict rejection
  if (session.current_phase === 'get_ready') {
    console.log(`[CONTINUE] Already in get_ready for session ${session.id}, ignoring`);
    return res.json({ ok: true, message: 'Already advancing' });
  }
  if (session.current_phase === 'question') {
    console.log(`[CONTINUE] Already on question for session ${session.id}, ignoring`);
    return res.json({ ok: true, message: 'Already on next question' });
  }
  if (session.current_phase === 'finished') {
    console.log(`[CONTINUE] Session ${session.id} already finished, ignoring`);
    return res.json({ ok: true, message: 'Quiz finished' });
  }
  if (session.current_phase !== 'waiting_for_continue' && session.current_phase !== 'scoreboard') {
    // For other phases (correct_answer, round_result), skip straight to continue
    console.log(`[CONTINUE] Phase is '${session.current_phase}' for session ${session.id}, forcing to continue`);
  }

  const io = req.app.get('io');
  
  // Clear ALL pending timeouts for this session
  clearAllSessionTimeouts(session.id);
  
  // Calculate the next index (current_question_index was NOT incremented in auto-close)
  const nextIndex = session.current_question_index + 1;
  
  // Bounds check - if no more questions, finish the quiz
  if (nextIndex >= questions.length) {
    console.log(`[CONTINUE] Last question done, finishing session ${session.id}`);
    db.prepare('UPDATE session SET status = ?, current_phase = ? WHERE id = ?').run('finished', 'finished', session.id);
    const finalScores = getSessionScores(session.id);
    io.to(`session:${session.id}`).emit('session:finished', {
      results: finalScores,
      resultsUrl: `/results/${session.id}`
    });
    cleanupSession(session.id);
    return res.json({ ok: true, message: 'Quiz finished' });
  }
  
  // Show "Get Ready" screen
  const getReadyStartedAt = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE session SET current_phase = ?, question_started_at = ? WHERE id = ?').run('get_ready', getReadyStartedAt, session.id);
  io.to(`session:${session.id}`).emit('session:get_ready', { 
    countdown: 5,
    getReadyStartedAt,
    nextQuestionIndex: nextIndex,
    totalQuestions: questions.length
  });
  
  // After 5 seconds, show the question (tracked timeout)
  const getReadyId = setTimeout(() => {
    getReadyTimeouts.delete(session.id);
    advanceToNextQuestion(io, session.id, nextIndex, questions, quiz);
    
    // Schedule auto-close for this question only if timed
    const answerTimeSecs = session.answer_time_seconds;
    const scoreboardPauseSecs = session.scoreboard_pause_seconds || 10;
    if (answerTimeSecs) {
      scheduleAutoClose(io, session.id, answerTimeSecs, scoreboardPauseSecs);
    }
  }, 5000);
  getReadyTimeouts.set(session.id, getReadyId);

  res.json({ ok: true });
});

// Manual phase advancement - for recovery or manual control
router.post('/session/:sessionId/advance-phase', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });

  const io = req.app.get('io');
  const currentPhase = session.current_phase;
  const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  const currentQuestion = questions[session.current_question_index];
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const scoreboardPauseSeconds = quiz.scoreboard_pause_seconds || 10;

  // Cancel ALL pending timeouts for this session
  clearAllSessionTimeouts(session.id);

  // Determine next phase based on current phase
  if (currentPhase === 'correct_answer') {
    // Advance to round_result
    const roundWinner = getRoundWinner(currentQuestion.id, session.id);
    if (roundWinner) {
      db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('round_result', session.id);
      io.to(`session:${session.id}`).emit('session:round_result', { 
        winner: roundWinner,
        displayDuration: 10
      });
    } else {
      // Skip to scoreboard if no winner
      db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('scoreboard', session.id);
      const scores = getSessionScores(session.id);
      io.to(`session:${session.id}`).emit('session:scores', { scores });
    }
  } else if (currentPhase === 'round_result') {
    // Advance to scoreboard
    db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('scoreboard', session.id);
    const scores = getSessionScores(session.id);
    const roundWinner = getRoundWinner(currentQuestion.id, session.id);
    io.to(`session:${session.id}`).emit('session:scores', { 
      scores,
      roundWinner
    });
  } else if (currentPhase === 'scoreboard') {
    const nextIndex = session.current_question_index + 1;
    
    // If this was the last question, finish the quiz
    if (nextIndex >= questions.length) {
      db.prepare('UPDATE session SET status = ?, current_phase = ? WHERE id = ?').run('finished', 'finished', session.id);
      const finalScores = getSessionScores(session.id);
      io.to(`session:${session.id}`).emit('session:finished', {
        results: finalScores,
        resultsUrl: `/results/${session.id}`
      });
      cleanupSession(session.id);
      console.log(`[ADVANCE-PHASE] Last question done, finishing session ${session.id}`);
      return res.json({ ok: true, phase: 'finished' });
    }
    
    // Go directly to next question (Get Ready → Question)
    const getReadyStartedAt = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE session SET current_phase = ?, question_started_at = ? WHERE id = ?').run('get_ready', getReadyStartedAt, session.id);
    io.to(`session:${session.id}`).emit('session:get_ready', { 
      countdown: 5,
      getReadyStartedAt,
      nextQuestionIndex: nextIndex,
      totalQuestions: questions.length
    });
    
    const getReadyId = setTimeout(() => {
      getReadyTimeouts.delete(session.id);
      advanceToNextQuestion(io, session.id, nextIndex, questions, quiz);
      const answerTimeSecs = session.answer_time_seconds;
      const scoreboardPauseSecs = session.scoreboard_pause_seconds || 10;
      if (answerTimeSecs) {
        scheduleAutoClose(io, session.id, answerTimeSecs, scoreboardPauseSecs);
      }
    }, 5000);
    getReadyTimeouts.set(session.id, getReadyId);
  }

  res.json({ ok: true, phase: session.current_phase });
});

// Manual close question (for untimed mode)
router.post('/session/:sessionId/close-question', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  const session = verifyAdminToken(req.params.sessionId, adminToken);
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
  if (session.current_phase !== 'question') {
    return res.json({ ok: true, message: 'Not in question phase' });
  }

  const io = req.app.get('io');
  clearAllSessionTimeouts(session.id);

  const scoreboardPauseSecs = session.scoreboard_pause_seconds || 10;
  executeQuestionClose(io, session.id, scoreboardPauseSecs);

  res.json({ ok: true });
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
  const answerTimeSeconds = session.answer_time_seconds || null;
  const scoreboardPauseSeconds = session.scoreboard_pause_seconds || 10;

  if (session.status === 'waiting') {
    const participants = db.prepare('SELECT * FROM participant WHERE session_id = ?').all(session.id);
    return res.json({
      status: 'waiting',
      joinCode: session.join_code,
      sessionName: session.session_name,
      questionIndex: 0,
      totalQuestions: questions.length,
      scores,
      themeColor,
      lightMode,
      answerTimeSeconds,
      scoreboardPauseSeconds,
      participants: participants.map(p => ({ displayName: p.display_name, teamName: p.team_name }))
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
  if (!currentQuestion) return res.json({ 
    status: 'active', 
    joinCode: session.join_code, 
    scores, 
    themeColor, 
    lightMode, 
    questionIndex: session.current_question_index, 
    totalQuestions: questions.length,
    answerTimeSeconds,
    scoreboardPauseSeconds
  });

  const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(currentQuestion.id);

  // Build phase-specific data for restoring display state on reload.
  // The correct value/answers are only revealed once the question is closed
  // (issue #7) — this endpoint is unauthenticated and polled by players.
  let roundWinner = null;
  let correctAnswers = null;
  const revealed = ['correct_answer', 'scoreboard', 'waiting_for_continue'].includes(session.current_phase);
  if (['round_result', 'correct_answer', 'scoreboard', 'waiting_for_continue'].includes(session.current_phase)) {
    roundWinner = getRoundWinner(currentQuestion.id, session.id);
  }
  if (revealed) {
    const correctAns = db.prepare('SELECT * FROM answer WHERE question_id = ? AND is_correct = 1').all(currentQuestion.id);
    correctAnswers = correctAns.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined }));
  }

  res.json({
    status: 'active',
    joinCode: session.join_code,
    currentPhase: session.current_phase,
    question: {
      id: currentQuestion.id,
      text: currentQuestion.text,
      imageUrl: currentQuestion.image_url,
      type: currentQuestion.type,
      correctValue: revealed ? currentQuestion.correct_value : null
    },
    answers: answers.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined })),
    questionIndex: session.current_question_index,
    totalQuestions: questions.length,
    themeColor,
    lightMode,
    scores,
    questionStartedAt: session.question_started_at,
    getReadyStartedAt: session.current_phase === 'get_ready' ? session.question_started_at : null,
    answerTimeSeconds,
    scoreboardPauseSeconds,
    roundWinner,
    correctAnswers
  });
});

// Get session results
router.get('/session/:sessionId/results', (req, res) => {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const scores = getSessionScores(session.id);
  const quiz = db.prepare('SELECT * FROM quiz WHERE id = ?').get(session.quiz_id);
  const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
  const participants = db.prepare('SELECT * FROM participant WHERE session_id = ? ORDER BY score DESC').all(session.id);

  // Build per-player question breakdown
  const breakdown = {};
  for (const p of participants) {
    breakdown[p.display_name] = questions.map(q => {
      const resp = db.prepare('SELECT * FROM response WHERE participant_id = ? AND question_id = ?').get(p.id, q.id);
      if (!resp) return { question: q.text, answer: null, correct: false, points: 0 };

      let answerText = null;
      if (resp.answer_id) {
        answerText = db.prepare('SELECT text FROM answer WHERE id = ?').get(resp.answer_id)?.text || null;
      } else if (resp.text_answer) {
        // Check for comma-separated answer IDs (multiple_choice)
        const ids = resp.text_answer.split(',');
        const texts = ids.map(id => db.prepare('SELECT text FROM answer WHERE id = ?').get(id)?.text).filter(Boolean);
        answerText = texts.length === ids.length && texts.length > 0 ? texts.join(', ') : resp.text_answer;
      }

      return { question: q.text, answer: answerText, correct: !!resp.is_correct, points: resp.points_awarded || 0 };
    });
  }

  res.json({
    quizTitle: quiz.title,
    status: session.status,
    scores,
    breakdown,
    themeColor: quiz.theme_color,
    lightMode: !!quiz.light_mode,
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

  // CSV cells: quote everything, double inner quotes, and neutralise formula
  // injection (cells starting with = + - @ or tab/CR) with a leading quote (issue #11).
  const cell = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };

  let csv = 'Rank,Name,Team,Score';
  for (const q of questions) {
    csv += ',' + cell(`Q${q.sort_order + 1}: ${q.text}`);
  }
  csv += '\n';

  participants.forEach((p, idx) => {
    csv += `${idx + 1},${cell(p.display_name)},${cell(p.team_name)},${p.score}`;
    for (const q of questions) {
      const resp = db.prepare('SELECT * FROM response WHERE participant_id = ? AND question_id = ?').get(p.id, q.id);
      if (resp) {
        let answerText;
        if (resp.answer_id) {
          answerText = db.prepare('SELECT text FROM answer WHERE id = ?').get(resp.answer_id)?.text || '';
        } else if (resp.text_answer) {
          // Check if text_answer contains comma-separated answer IDs (multiple_choice)
          const ids = resp.text_answer.split(',');
          const texts = ids.map(id => db.prepare('SELECT text FROM answer WHERE id = ?').get(id)?.text).filter(Boolean);
          answerText = texts.length === ids.length ? texts.join(', ') : resp.text_answer;
        } else {
          answerText = '';
        }
        csv += ',' + cell(`${resp.is_correct ? '✓' : '✗'} ${answerText}`);
      } else {
        csv += ',""';
      }
    }
    csv += '\n';
  });

  const safeName = quiz.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'quiz';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-results.csv"`);
  res.send('\uFEFF' + csv);
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

function getRoundWinner(questionId, sessionId) {
  // Get the fastest correct answer for this question IN THIS SESSION
  const winner = db.prepare(`
    SELECT p.id as participant_id, p.display_name, p.team_name, r.points_awarded, r.response_time_ms
    FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? 
      AND p.session_id = ?
      AND r.is_correct = 1 
      AND r.points_awarded > 0 
      AND r.response_time_ms IS NOT NULL
      AND r.response_time_ms > 0
    ORDER BY r.response_time_ms ASC
    LIMIT 1
  `).get(questionId, sessionId);

  if (!winner || !winner.response_time_ms) return null;

  return {
    participantId: winner.participant_id,
    name: winner.display_name,
    team: winner.team_name,
    points: winner.points_awarded,
    timeMs: winner.response_time_ms
  };
}

// Score an estimation question for ONE session: rank responses by proximity to
// the correct value. Runs in a transaction and is idempotent per session
// (a question that already has points in this session is not scored again).
const scoreEstimationQuestion = db.transaction((question, sessionId) => {
  const responses = db.prepare(`
    SELECT r.id, r.participant_id, r.text_answer, r.points_awarded FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ? AND r.text_answer IS NOT NULL
  `).all(question.id, sessionId);

  if (responses.length === 0) return;
  if (responses.some(r => r.points_awarded > 0)) {
    console.log(`[ESTIMATION] Question ${question.id} already scored for session ${sessionId}, skipping`);
    return;
  }

  // Rank by proximity
  const ranked = responses
    .map(r => ({ ...r, distance: Math.abs(parseFloat(r.text_answer) - question.correct_value) }))
    .filter(r => !Number.isNaN(r.distance))
    .sort((a, b) => a.distance - b.distance);

  const basePointsTable = [1000, 800, 600, 500, 400];
  const updateResponse = db.prepare('UPDATE response SET is_correct = ?, points_awarded = ? WHERE id = ?');
  const updateScore = db.prepare('UPDATE participant SET score = score + ? WHERE id = ?');

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    let points = i < basePointsTable.length ? basePointsTable[i] : 200;
    if (r.distance === 0) points += 200; // exact match bonus

    updateResponse.run(points > 0 ? 1 : 0, points, r.id);
    updateScore.run(points, r.participant_id);
  }
});

// Auto-close: schedule automatic close of question and show results (manual mode)
function scheduleAutoClose(io, sessionId, answerTimeSeconds, scoreboardPauseSeconds) {
  console.log(`[AUTO-CLOSE] Scheduling for session ${sessionId} in ${answerTimeSeconds} seconds`);
  const timeoutId = setTimeout(() => {
    console.log(`[AUTO-CLOSE] Timer expired for session ${sessionId}, calling executeQuestionClose`);
    autoCloseTimeouts.delete(sessionId);
    executeQuestionClose(io, sessionId, scoreboardPauseSeconds);
  }, answerTimeSeconds * 1000);
  
  autoCloseTimeouts.set(sessionId, timeoutId);
}

// Execute question close logic (called either by timer or when all answered)
function executeQuestionClose(io, sessionId, scoreboardPauseSeconds) {
  console.log(`[EXECUTE-CLOSE] Called for session ${sessionId}`);
  
  // Cancel any pending timeout (in case this is an early advance)
  if (autoCloseTimeouts.has(sessionId)) {
    clearTimeout(autoCloseTimeouts.get(sessionId));
    autoCloseTimeouts.delete(sessionId);
  }
  
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId);
  if (!session) {
    console.log(`[EXECUTE-CLOSE] Session ${sessionId} not found`);
    return;
  }
  if (session.status !== 'active') {
    console.log(`[EXECUTE-CLOSE] Session ${sessionId} not active (status: ${session.status})`);
    return;
  }
  const questions = db.prepare(`
    SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order
  `).all(session.quiz_id);
  const currentIndex = session.current_question_index;

  // Close current question
  let roundWinner = null;
  if (currentIndex < questions.length) {
    const currentQuestion = questions[currentIndex];
    
    // Check if already closed
    if (isQuestionClosed(sessionId, currentQuestion.id)) {
      console.log(`[EARLY-CLOSE] Question ${currentIndex + 1} already closed, skipping`);
      return;
    }
    
    markQuestionClosed(sessionId, currentQuestion.id);

    if (currentQuestion.type === 'estimation' && currentQuestion.correct_value !== null) {
      scoreEstimationQuestion(currentQuestion, sessionId);
    }

    roundWinner = getRoundWinner(currentQuestion.id, sessionId);
    console.log(`[QUESTION-CLOSE] Question ${currentIndex + 1} (ID: ${currentQuestion.id}): Round winner =`, roundWinner ? `${roundWinner.name} (${roundWinner.timeMs}ms, ${roundWinner.points}pts)` : 'NONE');
    
    // Get correct answers for reveal
    const correctAnswers = db.prepare('SELECT * FROM answer WHERE question_id = ? AND is_correct = 1').all(currentQuestion.id);
    
    // Get response statistics
    const correctResponses = db.prepare(`
      SELECT COUNT(*) as count FROM response r
      JOIN participant p ON p.id = r.participant_id
      WHERE r.question_id = ? AND p.session_id = ? AND r.is_correct = 1
    `).get(currentQuestion.id, sessionId);
    
    const totalResponses = db.prepare(`
      SELECT COUNT(*) as count FROM response r
      JOIN participant p ON p.id = r.participant_id
      WHERE r.question_id = ? AND p.session_id = ?
    `).get(currentQuestion.id, sessionId);
    
    // Show correct answer reveal for 5 seconds
    db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('correct_answer', sessionId);
    io.to(`session:${sessionId}`).emit('session:correct_answer', {
      question: {
        id: currentQuestion.id,
        text: currentQuestion.text,
        type: currentQuestion.type,
        correctValue: currentQuestion.correct_value
      },
      correctAnswers: correctAnswers.map(a => ({
        id: a.id,
        text: a.text,
        partLabel: a.part_label
      })),
      correctCount: correctResponses?.count || 0,
      totalCount: totalResponses?.count || 0,
      displayDuration: 5
    });
  }

  // Show round result after correct answer reveal
  addPhaseTimeout(sessionId, () => {
    // Re-check phase - skip if manually advanced past this
    const freshSession = db.prepare('SELECT current_phase FROM session WHERE id = ?').get(sessionId);
    if (freshSession && freshSession.current_phase !== 'correct_answer') {
      console.log(`[PHASE-SKIP] Session ${sessionId} already past correct_answer (at ${freshSession.current_phase}), skipping round_result timer`);
      return;
    }
    if (roundWinner) {
      db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('round_result', sessionId);
      io.to(`session:${sessionId}`).emit('session:round_result', { 
        winner: roundWinner,
        displayDuration: 10
      });
    }

      // Then show scoreboard
      addPhaseTimeout(sessionId, () => {
        const freshSession2 = db.prepare('SELECT current_phase FROM session WHERE id = ?').get(sessionId);
        if (freshSession2 && freshSession2.current_phase !== 'round_result' && freshSession2.current_phase !== 'correct_answer') {
          console.log(`[PHASE-SKIP] Session ${sessionId} already past round_result (at ${freshSession2.current_phase}), skipping scoreboard timer`);
          return;
        }
        const scores = getSessionScores(sessionId);
        db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('scoreboard', sessionId);
        io.to(`session:${sessionId}`).emit('session:scores', { 
          scores, 
          roundWinner: roundWinner
        });

        const nextIndex = currentIndex + 1;

        // DON'T update the question index yet - wait for manual continue
        // Check if this was the last question
        if (nextIndex >= questions.length) {
          addPhaseTimeout(sessionId, () => {
            const freshSession3 = db.prepare('SELECT current_phase FROM session WHERE id = ?').get(sessionId);
            if (freshSession3 && freshSession3.current_phase !== 'scoreboard') {
              console.log(`[PHASE-SKIP] Session ${sessionId} already past scoreboard (at ${freshSession3.current_phase}), skipping finished timer`);
              return;
            }
            db.prepare('UPDATE session SET status = ?, current_phase = ? WHERE id = ?')
              .run('finished', 'finished', sessionId);

            const finalScores = getSessionScores(sessionId);
            io.to(`session:${sessionId}`).emit('session:finished', {
              results: finalScores,
              resultsUrl: `/results/${sessionId}`
            });
            cleanupSession(sessionId);
          }, scoreboardPauseSeconds * 1000);
        } else {
          // Not the last question - emit event to tell host to show continue button
          addPhaseTimeout(sessionId, () => {
            const freshSession3 = db.prepare('SELECT current_phase FROM session WHERE id = ?').get(sessionId);
            if (freshSession3 && freshSession3.current_phase !== 'scoreboard') {
              console.log(`[PHASE-SKIP] Session ${sessionId} already past scoreboard (at ${freshSession3.current_phase}), skipping waiting_for_continue timer`);
              return;
            }
            // Get statistics for the just-completed question
            const currentQuestion = questions[currentIndex];
            const correctAnswers = db.prepare('SELECT * FROM answer WHERE question_id = ? AND is_correct = 1').all(currentQuestion.id);
            
            // Count correct vs total responses
            const totalResponses = db.prepare(`
              SELECT COUNT(*) as count FROM response r
              JOIN participant p ON p.id = r.participant_id
              WHERE r.question_id = ? AND p.session_id = ?
            `).get(currentQuestion.id, sessionId);
            
            const correctResponses = db.prepare(`
              SELECT COUNT(*) as count FROM response r
              JOIN participant p ON p.id = r.participant_id
              WHERE r.question_id = ? AND p.session_id = ? AND r.is_correct = 1
            `).get(currentQuestion.id, sessionId);
            
            // Update phase to waiting_for_continue
            db.prepare('UPDATE session SET current_phase = ? WHERE id = ?').run('waiting_for_continue', sessionId);
            
            const nextQuestionObj = questions[nextIndex];
            io.to(`session:${sessionId}`).emit('session:waiting_for_continue', { 
              nextIndex,
              nextQuestion: nextQuestionObj ? { text: nextQuestionObj.text, type: nextQuestionObj.type, imageUrl: nextQuestionObj.image_url } : null,
              questionStats: {
                question: {
                  text: currentQuestion.text,
                  type: currentQuestion.type,
                  correctValue: currentQuestion.correct_value
                },
                correctAnswers: correctAnswers.map(a => ({
                  text: a.text,
                  partLabel: a.part_label
                })),
                correctCount: correctResponses?.count || 0,
                totalCount: totalResponses?.count || 0
              }
            });
          }, scoreboardPauseSeconds * 1000);
        }
      }, roundWinner ? 10000 : 0);
  }, 5000); // Wait 5 seconds after correct answer reveal
}

// Advance to next question
function advanceToNextQuestion(io, sessionId, nextIndex, questions, quiz) {
  // Bounds check
  if (nextIndex >= questions.length) {
    console.log(`[ADVANCE] nextIndex ${nextIndex} >= ${questions.length} questions, finishing session ${sessionId}`);
    db.prepare('UPDATE session SET status = ?, current_phase = ? WHERE id = ?').run('finished', 'finished', sessionId);
    const finalScores = getSessionScores(sessionId);
    io.to(`session:${sessionId}`).emit('session:finished', { results: finalScores, resultsUrl: `/results/${sessionId}` });
    cleanupSession(sessionId);
    return;
  }
  
  // Verify session is still active
  const currentSession = db.prepare('SELECT status FROM session WHERE id = ?').get(sessionId);
  if (!currentSession || currentSession.status !== 'active') {
    console.log(`[ADVANCE] Session ${sessionId} no longer active (status: ${currentSession?.status}), skipping`);
    return;
  }
  
  const nextQuestion = questions[nextIndex];
  const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(nextQuestion.id);

  const questionStartTime = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE session SET current_question_index = ?, question_started_at = ?, current_phase = ? WHERE id = ?')
    .run(nextIndex, questionStartTime, 'question', sessionId);

  const sessionRow = db.prepare('SELECT answer_time_seconds FROM session WHERE id = ?').get(sessionId);

  const payload = {
    question: { id: nextQuestion.id, text: nextQuestion.text, imageUrl: nextQuestion.image_url, type: nextQuestion.type },
    answers: answers.map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined })),
    questionIndex: nextIndex,
    totalQuestions: questions.length,
    questionStartedAt: questionStartTime,
    answerTimeSeconds: sessionRow?.answer_time_seconds || null
  };

  io.to(`session:${sessionId}`).emit('session:question', payload);
}

export default router;
export { executeQuestionClose };
