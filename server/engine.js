// Session engine: the single phase machine for a running quiz session
// (issues #24, #25, #21).
//
// Phases:  waiting -> get_ready -> question -> correct_answer -> round_result
//          -> scoreboard -> waiting_for_continue -> get_ready ... -> finished
//
// Every transition lives here, is driven by one tracked timer per session,
// re-checks the phase in the database before acting, and emits the same
// socket events the clients already understand. buildSessionState() is the
// one projection of a session used by REST /current and every socket
// handshake, so a reloaded page always gets the full picture.

import db from './db/db.js';

export const GET_READY_MS = 5000;
export const REVEAL_MS = 5000;
export const ROUND_RESULT_MS = 10000;
export const REVEAL_PHASES = ['correct_answer', 'round_result', 'scoreboard', 'waiting_for_continue'];

let io = null;
export function attachIo(instance) { io = instance; }
function emit(sessionId, event, payload) {
  if (io) io.to(`session:${sessionId}`).emit(event, payload);
}

// ---------- timers ----------
const timers = new Map(); // sessionId -> Set<timeoutId>
const closedQuestions = new Map(); // sessionId -> Set<questionId>

function schedule(sessionId, fn, delay) {
  const id = setTimeout(() => {
    timers.get(sessionId)?.delete(id);
    try { fn(); } catch (e) { console.error(`[ENGINE] timer for ${sessionId} failed:`, e); }
  }, delay);
  if (!timers.has(sessionId)) timers.set(sessionId, new Set());
  timers.get(sessionId).add(id);
  return id;
}

export function clearTimers(sessionId) {
  const set = timers.get(sessionId);
  if (!set) return;
  for (const id of set) clearTimeout(id);
  timers.delete(sessionId);
}

export function cleanupSession(sessionId) {
  clearTimers(sessionId);
  closedQuestions.delete(sessionId);
}

// ---------- queries ----------
export function loadSession(sessionId) {
  return db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId) || null;
}

export function getQuestions(quizId) {
  return db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(quizId);
}

export function publicQuestion(q, { revealed = false } = {}) {
  if (!q) return null;
  return {
    id: q.id,
    text: q.text,
    imageUrl: q.image_url,
    type: q.type,
    correctValue: revealed ? q.correct_value : null
  };
}

export function publicAnswers(questionId) {
  return db.prepare('SELECT id, text, part_label FROM answer WHERE question_id = ?').all(questionId)
    .map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined }));
}

export function getSessionScores(sessionId) {
  return db.prepare(`
    SELECT display_name, team_name, score FROM participant
    WHERE session_id = ? ORDER BY score DESC
  `).all(sessionId).map(p => ({ name: p.display_name, team: p.team_name, score: p.score }));
}

export function getRoundWinner(questionId, sessionId) {
  const w = db.prepare(`
    SELECT p.id as participant_id, p.display_name, p.team_name, r.points_awarded, r.response_time_ms
    FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
      AND r.is_correct = 1 AND r.points_awarded > 0
      AND r.response_time_ms IS NOT NULL AND r.response_time_ms > 0
    ORDER BY r.response_time_ms ASC
    LIMIT 1
  `).get(questionId, sessionId);
  if (!w) return null;
  return { participantId: w.participant_id, name: w.display_name, team: w.team_name, points: w.points_awarded, timeMs: w.response_time_ms };
}

export function getAnswerCount(questionId, sessionId) {
  const answered = db.prepare(`
    SELECT p.display_name FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
  `).all(questionId, sessionId).map(r => r.display_name);
  const all = db.prepare('SELECT display_name FROM participant WHERE session_id = ?').all(sessionId).map(p => p.display_name);
  return { count: answered.length, total: all.length, answered, waiting: all.filter(n => !answered.includes(n)) };
}

export function questionStats(question, sessionId) {
  const counts = db.prepare(`
    SELECT COUNT(*) as total, SUM(r.is_correct) as correct FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ?
  `).get(question.id, sessionId);
  const correctAnswers = db.prepare('SELECT id, text, part_label FROM answer WHERE question_id = ? AND is_correct = 1').all(question.id)
    .map(a => ({ id: a.id, text: a.text, partLabel: a.part_label || undefined }));
  return {
    question: { id: question.id, text: question.text, type: question.type, correctValue: question.correct_value },
    correctAnswers,
    correctCount: counts?.correct || 0,
    totalCount: counts?.total || 0
  };
}

// Full projection of a session for clients (issue #25).
export function buildSessionState(sessionId) {
  const session = loadSession(sessionId);
  if (!session) return null;
  const quiz = db.prepare('SELECT theme_color, light_mode FROM quiz WHERE id = ?').get(session.quiz_id);
  const questions = getQuestions(session.quiz_id);
  const base = {
    status: session.status,
    joinCode: session.join_code,
    sessionName: session.session_name,
    totalQuestions: questions.length,
    scores: getSessionScores(sessionId),
    themeColor: quiz?.theme_color || null,
    lightMode: !!quiz?.light_mode,
    answerTimeSeconds: session.answer_time_seconds || null,
    scoreboardPauseSeconds: session.scoreboard_pause_seconds || 10
  };

  if (session.status === 'waiting') {
    const participants = db.prepare('SELECT display_name, team_name FROM participant WHERE session_id = ?').all(sessionId);
    return { ...base, questionIndex: 0, participants: participants.map(p => ({ displayName: p.display_name, teamName: p.team_name })) };
  }

  if (session.status === 'finished') {
    return {
      ...base,
      questionIndex: questions.length,
      questions: questions.map(q => ({ id: q.id, text: q.text, type: q.type, sortOrder: q.sort_order }))
    };
  }

  const phase = session.current_phase;
  const index = session.current_question_index;
  const current = questions[index] || null;
  const revealed = REVEAL_PHASES.includes(phase);
  const state = {
    ...base,
    currentPhase: phase,
    questionIndex: index,
    question: null,
    answers: [],
    questionStartedAt: phase === 'question' ? session.question_started_at : null,
    getReadyStartedAt: phase === 'get_ready' ? session.question_started_at : null,
    answerCount: null,
    roundWinner: null,
    questionStats: null,
    nextQuestion: null
  };
  // During get_ready the upcoming question is not shown yet.
  if (current && phase !== 'get_ready') {
    state.question = publicQuestion(current, { revealed });
    state.answers = publicAnswers(current.id);
    state.answerCount = getAnswerCount(current.id, sessionId);
  }
  if (current && revealed) {
    state.roundWinner = getRoundWinner(current.id, sessionId);
    state.questionStats = questionStats(current, sessionId);
    const next = questions[index + 1];
    state.nextQuestion = next ? publicQuestion(next) : null;
  }
  return state;
}

// ---------- transitions ----------
function setPhase(sessionId, phase, extra = {}) {
  const cols = ['current_phase = ?'];
  const vals = [phase];
  for (const [k, v] of Object.entries(extra)) { cols.push(`${k} = ?`); vals.push(v); }
  vals.push(sessionId);
  db.prepare(`UPDATE session SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
}

function activeSession(sessionId, expectedPhases) {
  const s = loadSession(sessionId);
  if (!s || s.status !== 'active') return null;
  if (expectedPhases && !expectedPhases.includes(s.current_phase)) return null;
  return s;
}

export function generateJoinCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!db.prepare('SELECT id FROM session WHERE join_code = ?').get(code)) return code;
  }
  throw new Error('Could not generate unique join code');
}

// Start: waiting -> get_ready for question 0. Returns an error string or null.
export function startSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session) return 'Session not found';
  if (session.status === 'finished') return 'Session already finished';
  if (session.status === 'active' && !(session.current_phase === 'get_ready' && session.current_question_index === 0)) {
    return 'Session already started';
  }
  const questions = getQuestions(session.quiz_id);
  if (questions.length === 0) return 'Quiz has no questions';
  cleanupSession(sessionId);
  db.prepare('UPDATE session SET status = ?, auto_mode = 0 WHERE id = ?').run('active', sessionId);
  beginQuestion(sessionId, 0);
  return null;
}

// get_ready countdown, then the question. Finishes the session when past the end.
export function beginQuestion(sessionId, index) {
  const session = activeSession(sessionId);
  if (!session) return;
  const questions = getQuestions(session.quiz_id);
  if (index >= questions.length) return finishSession(sessionId);

  clearTimers(sessionId);
  const startedAt = Math.floor(Date.now() / 1000);
  setPhase(sessionId, 'get_ready', { current_question_index: index, question_started_at: startedAt });
  emit(sessionId, 'session:get_ready', {
    countdown: GET_READY_MS / 1000,
    getReadyStartedAt: startedAt,
    nextQuestionIndex: index,
    totalQuestions: questions.length
  });
  schedule(sessionId, () => showQuestion(sessionId, index), GET_READY_MS);
}

export function showQuestion(sessionId, index) {
  const session = activeSession(sessionId);
  if (!session) return;
  const questions = getQuestions(session.quiz_id);
  const question = questions[index];
  if (!question) return finishSession(sessionId);

  const startedAt = Math.floor(Date.now() / 1000);
  setPhase(sessionId, 'question', { current_question_index: index, question_started_at: startedAt });
  emit(sessionId, 'session:question', {
    question: publicQuestion(question),
    answers: publicAnswers(question.id),
    questionIndex: index,
    totalQuestions: questions.length,
    questionStartedAt: startedAt,
    answerTimeSeconds: session.answer_time_seconds || null
  });
  if (session.answer_time_seconds) {
    schedule(sessionId, () => closeQuestion(sessionId), session.answer_time_seconds * 1000);
  }
}

// Close the open question: score, reveal, then the automatic result sequence.
// Safe to call from the timer, from "everyone answered" and from the host.
export function closeQuestion(sessionId) {
  const session = activeSession(sessionId, ['question']);
  if (!session) return false;
  const questions = getQuestions(session.quiz_id);
  const question = questions[session.current_question_index];
  if (!question) return false;
  if (!closedQuestions.has(sessionId)) closedQuestions.set(sessionId, new Set());
  if (closedQuestions.get(sessionId).has(question.id)) return false;
  closedQuestions.get(sessionId).add(question.id);
  clearTimers(sessionId);

  if (question.type === 'estimation' && question.correct_value !== null) {
    scoreEstimationQuestion(question, sessionId);
  }
  const stats = questionStats(question, sessionId);
  const winner = getRoundWinner(question.id, sessionId);
  console.log(`[CLOSE] ${sessionId} Q${session.current_question_index + 1}: winner=${winner ? `${winner.name} ${winner.timeMs}ms` : 'none'}`);

  setPhase(sessionId, 'correct_answer');
  emit(sessionId, 'session:correct_answer', { ...stats, displayDuration: REVEAL_MS / 1000 });
  schedule(sessionId, () => showRoundResult(sessionId), REVEAL_MS);
  return true;
}

export function showRoundResult(sessionId) {
  const session = activeSession(sessionId, ['correct_answer']);
  if (!session) return;
  clearTimers(sessionId);
  const question = getQuestions(session.quiz_id)[session.current_question_index];
  const winner = question ? getRoundWinner(question.id, sessionId) : null;
  if (!winner) return showScoreboard(sessionId);
  setPhase(sessionId, 'round_result');
  emit(sessionId, 'session:round_result', { winner, displayDuration: ROUND_RESULT_MS / 1000 });
  schedule(sessionId, () => showScoreboard(sessionId), ROUND_RESULT_MS);
}

export function showScoreboard(sessionId) {
  const session = activeSession(sessionId, ['correct_answer', 'round_result']);
  if (!session) return;
  clearTimers(sessionId);
  const question = getQuestions(session.quiz_id)[session.current_question_index];
  const pause = (session.scoreboard_pause_seconds || 10) * 1000;
  setPhase(sessionId, 'scoreboard');
  emit(sessionId, 'session:scores', {
    scores: getSessionScores(sessionId),
    roundWinner: question ? getRoundWinner(question.id, sessionId) : null,
    scoreboardPauseSeconds: pause / 1000,
    scoreboardStartedAt: Math.floor(Date.now() / 1000)
  });
  schedule(sessionId, () => afterScoreboard(sessionId), pause);
}

export function afterScoreboard(sessionId) {
  const session = activeSession(sessionId, ['scoreboard']);
  if (!session) return;
  clearTimers(sessionId);
  const questions = getQuestions(session.quiz_id);
  const index = session.current_question_index;
  if (index + 1 >= questions.length) return finishSession(sessionId);
  const question = questions[index];
  setPhase(sessionId, 'waiting_for_continue');
  emit(sessionId, 'session:waiting_for_continue', {
    nextIndex: index + 1,
    nextQuestion: publicQuestion(questions[index + 1]),
    questionStats: questionStats(question, sessionId)
  });
}

// Host: next question (from any post-question phase). Returns message or null.
export function continueSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session || session.status !== 'active') return 'Session not active';
  if (session.current_phase === 'get_ready') return 'Already advancing';
  if (session.current_phase === 'question') return 'Already on a question';
  beginQuestion(sessionId, session.current_question_index + 1);
  return null;
}

// Host: skip the current result phase.
export function advancePhase(sessionId) {
  const session = loadSession(sessionId);
  if (!session || session.status !== 'active') return 'Session not active';
  switch (session.current_phase) {
    case 'question': closeQuestion(sessionId); break;
    case 'correct_answer': showRoundResult(sessionId); break;
    case 'round_result': showScoreboard(sessionId); break;
    case 'scoreboard': afterScoreboard(sessionId); break;
    case 'waiting_for_continue': beginQuestion(sessionId, session.current_question_index + 1); break;
    default: return 'Nothing to advance';
  }
  return null;
}

export function finishSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session) return;
  clearTimers(sessionId);
  const total = getQuestions(session.quiz_id).length;
  db.prepare('UPDATE session SET status = ?, current_phase = ?, current_question_index = ? WHERE id = ?')
    .run('finished', 'finished', total, sessionId);
  emit(sessionId, 'session:finished', { results: getSessionScores(sessionId), resultsUrl: `/results/${sessionId}` });
  cleanupSession(sessionId);
}

// Host: wipe participants and responses, new join code, back to waiting.
export function resetSession(sessionId) {
  cleanupSession(sessionId);
  emit(sessionId, 'session:reset');
  const joinCode = generateJoinCode();
  db.transaction(() => {
    db.prepare('DELETE FROM participant WHERE session_id = ?').run(sessionId); // responses cascade
    db.prepare(`
      UPDATE session SET status = 'waiting', current_question_index = 0, auto_mode = 0,
        question_started_at = NULL, current_phase = 'waiting', join_code = ?
      WHERE id = ?
    `).run(joinCode, sessionId);
  })();
  return joinCode;
}

// Score an estimation question for ONE session: rank responses by proximity.
// Transactional and idempotent per session.
const scoreEstimationQuestion = db.transaction((question, sessionId) => {
  const responses = db.prepare(`
    SELECT r.id, r.participant_id, r.text_answer, r.points_awarded FROM response r
    JOIN participant p ON p.id = r.participant_id
    WHERE r.question_id = ? AND p.session_id = ? AND r.text_answer IS NOT NULL
  `).all(question.id, sessionId);
  if (responses.length === 0 || responses.some(r => r.points_awarded > 0)) return;

  const ranked = responses
    .map(r => ({ ...r, distance: Math.abs(parseFloat(r.text_answer) - question.correct_value) }))
    .filter(r => !Number.isNaN(r.distance))
    .sort((a, b) => a.distance - b.distance);

  const table = [1000, 800, 600, 500, 400];
  const updateResponse = db.prepare('UPDATE response SET is_correct = 1, points_awarded = ? WHERE id = ?');
  const updateScore = db.prepare('UPDATE participant SET score = score + ? WHERE id = ?');
  ranked.forEach((r, i) => {
    const points = (i < table.length ? table[i] : 200) + (r.distance === 0 ? 200 : 0);
    updateResponse.run(points, r.id);
    updateScore.run(points, r.participant_id);
  });
});

// Called once at boot (issue #21): sessions that were mid-flight when the
// process died pick up where they were instead of freezing.
export function resumeActiveSessions() {
  const active = db.prepare("SELECT * FROM session WHERE status = 'active'").all();
  for (const s of active) {
    const now = Math.floor(Date.now() / 1000);
    switch (s.current_phase) {
      case 'get_ready':
        showQuestion(s.id, s.current_question_index);
        break;
      case 'question':
        if (s.answer_time_seconds) {
          const remaining = (s.question_started_at || now) + s.answer_time_seconds - now;
          if (remaining <= 0) closeQuestion(s.id);
          else schedule(s.id, () => closeQuestion(s.id), remaining * 1000);
        }
        break;
      case 'correct_answer':
        showRoundResult(s.id);
        break;
      case 'round_result':
        showScoreboard(s.id);
        break;
      case 'scoreboard':
        afterScoreboard(s.id);
        break;
      default:
        break; // waiting_for_continue: host decides
    }
    console.log(`[RESUME] session ${s.id} resumed in phase ${s.current_phase}`);
  }
  return active.length;
}

