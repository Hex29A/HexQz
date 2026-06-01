#!/usr/bin/env node

/**
 * HexQz Parallel Stress Test
 *
 * Creates multiple sessions from the same quiz and runs them in parallel to verify
 * that sessions do not interfere with each other.
 *
 * Usage:
 *   node parallel-stress-test.js [options]
 *
 * Options:
 *   --sessions <n>      Number of parallel sessions (default: 8)
 *   --players <n>       Number of players per session (default: 10)
 *   --base-url <url>    Server URL (default: http://localhost:3042)
 *   --auto-advance      Auto-start quiz sessions (requires ADMIN_SECRET env var)
 *   --answer-time <s>   Answer time in seconds per question (default: 10)
 *   --scoreboard <s>    Scoreboard pause in seconds (default: 3)
 *   --test-reconnect    Some players disconnect and reconnect mid-quiz
 *
 * Environment variables:
 *   ADMIN_SECRET - Required to create quiz and sessions
 *
 * Examples:
 *   ADMIN_SECRET=secret node parallel-stress-test.js --auto-advance
 *   ADMIN_SECRET=secret node parallel-stress-test.js --sessions 4 --players 20 --auto-advance
 */

import { io as ioClient } from 'socket.io-client';

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1];
}
function hasFlag(name) {
  return args.includes(name);
}

const NUM_SESSIONS = parseInt(getArg('--sessions', '8'), 10);
const PLAYERS_PER_SESSION = parseInt(getArg('--players', '10'), 10);
const BASE_URL = getArg('--base-url', 'http://localhost:3042');
const AUTO_ADVANCE = hasFlag('--auto-advance');
const ANSWER_TIME = parseInt(getArg('--answer-time', '10'), 10);
const SCOREBOARD_PAUSE = parseInt(getArg('--scoreboard', '3'), 10);
const TEST_RECONNECT = hasFlag('--test-reconnect');
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET environment variable is required');
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`🧪 HexQz Parallel Stress Test`);
console.log(`${'='.repeat(60)}`);
console.log(`Sessions:        ${NUM_SESSIONS}`);
console.log(`Players/session: ${PLAYERS_PER_SESSION}`);
console.log(`Total players:   ${NUM_SESSIONS * PLAYERS_PER_SESSION}`);
console.log(`Base URL:        ${BASE_URL}`);
console.log(`Auto-advance:    ${AUTO_ADVANCE}`);
console.log(`Test reconnect:  ${TEST_RECONNECT}`);
console.log(`Answer time:     ${ANSWER_TIME}s`);
console.log(`Scoreboard:      ${SCOREBOARD_PAUSE}s`);
console.log(`${'='.repeat(60)}\n`);

// ── Test questions (shared across all sessions via the same quiz) ────────────

const TEST_QUESTIONS = [
  {
    text: 'What is 2 + 2?',
    type: 'single_choice',
    answers: [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
      { text: '6', isCorrect: false }
    ]
  },
  {
    text: 'Which are primary colors?',
    type: 'multiple_choice',
    answers: [
      { text: 'Red', isCorrect: true },
      { text: 'Blue', isCorrect: true },
      { text: 'Green', isCorrect: false },
      { text: 'Yellow', isCorrect: true }
    ]
  },
  {
    text: 'The Earth is flat',
    type: 'true_false',
    answers: [
      { text: 'True', isCorrect: false },
      { text: 'False', isCorrect: true }
    ]
  },
  {
    text: 'What is the capital of France?',
    type: 'free_text',
    answers: [{ text: 'Paris', isCorrect: true }]
  },
  {
    text: 'How many continents are there?',
    type: 'numeric',
    correctValue: 7,
    tolerance: 0
  }
];

// ── Virtual Player ───────────────────────────────────────────────────────────

class VirtualPlayer {
  constructor(sessionLabel, playerNum, sessionId, joinCode, baseUrl, onEvent) {
    this.name = `${sessionLabel}_player${playerNum}`;
    this.sessionId = sessionId;
    this.joinCode = joinCode;
    this.baseUrl = baseUrl;
    this.participantId = null;
    this.socket = null;
    this.connected = false;
    this.answeredCount = 0;
    this.finished = false;
    this.questionsReceived = [];
    this.errors = [];
    this.onEvent = onEvent || (() => {});
    this.reconnectCount = 0;
    this.reconnectEnabled = false;
    this.reconnectScheduled = false;
    this._resolveFinished = null;
    this.finishedPromise = new Promise(resolve => { this._resolveFinished = resolve; });
  }

  async register() {
    try {
      const res = await fetch(`${this.baseUrl}/api/join/${this.joinCode}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: this.name })
      });
      if (!res.ok) {
        const err = await res.json();
        if (err.participantId) { this.participantId = err.participantId; return true; }
        this.errors.push(`Registration failed: ${err.error}`);
        return false;
      }
      const data = await res.json();
      this.participantId = data.participantId;
      return true;
    } catch (error) {
      this.errors.push(`Registration error: ${error.message}`);
      return false;
    }
  }

  connect() {
    return new Promise((resolve) => {
      this._createSocket(resolve);
    });
  }

  _createSocket(initialResolve) {
    this.socket = ioClient(this.baseUrl, {
      transports: ['websocket', 'polling'],
      reconnection: false // we handle reconnection ourselves
    });

    this.socket.on('connect', () => {
      this.connected = true;
      if (this.reconnectCount > 0) {
        // Rejoin with state sync
        this.socket.emit('rejoin:session', {
          sessionId: this.sessionId,
          participantId: this.participantId
        });
        this.onEvent('reconnected');
      } else {
        this.socket.emit('join:session', {
          sessionId: this.sessionId,
          participantId: this.participantId
        });
      }
      if (initialResolve) { initialResolve(); initialResolve = null; }
    });

    this.socket.on('disconnect', () => { this.connected = false; });

    this.socket.on('session:question', (data) => this.handleQuestion(data));
    this.socket.on('session:started', (data) => this.handleQuestion(data));
    this.socket.on('session:scores', () => { this.onEvent('scores'); });
    this.socket.on('session:correct_answer', () => { this.onEvent('correct_answer'); });
    this.socket.on('session:round_result', () => { this.onEvent('round_result'); });
    this.socket.on('session:get_ready', () => { this.onEvent('get_ready'); });
    this.socket.on('session:state', (data) => {
      // State sync after rejoin - if there's a question, handle it
      if (data.question && data.status === 'active') {
        this.onEvent('state_synced', data);
      }
    });

    this.socket.on('session:finished', () => {
      this.finished = true;
      this.disconnect();
      this._resolveFinished();
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!this.finished) {
        this.errors.push('Timed out waiting for session to finish');
        this.disconnect();
        this._resolveFinished();
      }
    }, 5 * 60 * 1000);
  }

  simulateReconnect() {
    if (this.finished || this.reconnectScheduled) return;
    this.reconnectScheduled = true;

    // Random delay before disconnecting (1-5s into the question)
    const disconnectDelay = 1000 + Math.random() * 4000;
    setTimeout(() => {
      if (this.finished) return;
      this.onEvent('disconnecting');
      if (this.socket) { this.socket.disconnect(); this.socket = null; }
      this.connected = false;

      // Reconnect after 2-6 seconds
      const reconnectDelay = 2000 + Math.random() * 4000;
      setTimeout(() => {
        if (this.finished) return;
        this.reconnectCount++;
        this.reconnectScheduled = false;
        this._createSocket(null);
      }, reconnectDelay);
    }, disconnectDelay);
  }

  async handleQuestion(data) {
    this.questionsReceived.push(data.question.id);
    this.onEvent('question', data);
    const answers = data.answers || [];

    // If reconnect testing is enabled, disconnect/reconnect on question 2 or 3
    if (this.reconnectEnabled && (this.questionsReceived.length === 2 || this.questionsReceived.length === 3)) {
      this.simulateReconnect();
      return; // Will miss this question's answer (expected)
    }

    // Answer quickly (0-3 seconds) to keep things fast
    const delay = Math.random() * 3000;
    setTimeout(() => this.submitAnswer(data.question, answers), delay);
  }

  async submitAnswer(question, answers) {
    if (!this.participantId) return;

    const body = { participantId: this.participantId, questionId: question.id };

    if (question.type === 'single_choice' || question.type === 'true_false') {
      if (answers.length > 0) body.answerId = answers[Math.floor(Math.random() * answers.length)].id;
    } else if (question.type === 'multiple_choice') {
      const numToSelect = Math.floor(Math.random() * 3) + 1;
      const selected = new Set();
      for (let i = 0; i < numToSelect && i < answers.length; i++) {
        selected.add(answers[Math.floor(Math.random() * answers.length)].id);
      }
      body.answerId = [...selected];
    } else if (question.type === 'free_text') {
      body.textAnswer = `Answer from ${this.name}`;
    } else if (question.type === 'numeric' || question.type === 'estimation') {
      body.textAnswer = String(Math.floor(Math.random() * 1000));
    } else if (question.type === 'multi_part') {
      const parts = {};
      const labels = [...new Set(answers.map(a => a.partLabel).filter(Boolean))];
      labels.forEach(label => { parts[label] = `${label} answer`; });
      body.textAnswer = JSON.stringify(parts);
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        this.answeredCount++;
        this.onEvent('answered');
      } else {
        // Late answers are expected sometimes
      }
    } catch (error) {
      this.errors.push(`Answer error: ${error.message}`);
    }
  }

  disconnect() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
  }
}

// ── Session Runner ───────────────────────────────────────────────────────────

class SessionRunner {
  constructor(index, sessionId, joinCode, adminToken, baseUrl, progressTracker) {
    this.index = index;
    this.label = `session${joinCode}`;
    this.sessionId = sessionId;
    this.joinCode = joinCode;
    this.adminToken = adminToken;
    this.baseUrl = baseUrl;
    this.players = [];
    this.results = null;
    this.progressTracker = progressTracker;
    this.currentQuestion = 0;
    this.totalAnswersThisQuestion = 0;
  }

  async setup(numPlayers) {
    const onEvent = (type, data) => {
      if (type === 'question') {
        // Only log once per question per session (from the first player to receive it)
        const qNum = this.currentQuestion + 1;
        if (data && data.question) {
          const newQ = this.players[0]?.questionsReceived.length || 0;
          if (newQ > this.currentQuestion) {
            this.totalAnswersThisQuestion = 0;
            this.currentQuestion = newQ;
            this.progressTracker.onQuestion(this.label, this.currentQuestion, data.question.text);
          }
        }
      } else if (type === 'answered') {
        this.totalAnswersThisQuestion++;
        this.progressTracker.onAnswer(this.label, this.totalAnswersThisQuestion, numPlayers);
      } else if (type === 'scores') {
        this.progressTracker.onPhase(this.label, 'scoreboard');
      } else if (type === 'correct_answer') {
        this.progressTracker.onPhase(this.label, 'correct_answer');
      } else if (type === 'get_ready') {
        this.progressTracker.onPhase(this.label, 'get_ready');
      } else if (type === 'reconnected') {
        this.progressTracker.onPhase(this.label, 'reconnected');
      } else if (type === 'disconnecting') {
        this.progressTracker.onPhase(this.label, 'disconnecting');
      } else if (type === 'state_synced') {
        this.progressTracker.onPhase(this.label, 'state_synced');
      }
    };

    // Create players
    for (let i = 1; i <= numPlayers; i++) {
      const player = new VirtualPlayer(this.label, i, this.sessionId, this.joinCode, this.baseUrl, onEvent);
      // Mark ~30% of players for reconnect testing
      if (TEST_RECONNECT && Math.random() < 0.3) {
        player.reconnectEnabled = true;
      }
      this.players.push(player);
    }

    // Register all
    const regResults = await Promise.all(this.players.map(p => p.register()));
    const registered = regResults.filter(Boolean).length;
    console.log(`  [${this.label}] Registered ${registered}/${numPlayers} players`);

    if (registered === 0) throw new Error(`No players registered for ${this.label}`);

    // Connect all
    const activePlayers = this.players.filter((_, i) => regResults[i]);
    await Promise.all(activePlayers.map(p => p.connect()));
    const connected = activePlayers.filter(p => p.connected).length;
    console.log(`  [${this.label}] Connected ${connected}/${registered} players`);
  }

  async start() {
    console.log(`  [${this.label}] Starting quiz (auto-mode)...`);
    const res = await fetch(`${this.baseUrl}/api/session/${this.sessionId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': this.adminToken
      },
      body: JSON.stringify({ autoMode: true })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to start ${this.label}: ${err}`);
    }
    console.log(`  [${this.label}] ✅ Started`);
  }

  async waitForFinish() {
    await Promise.all(this.players.map(p => p.finishedPromise));
    this.progressTracker.onFinished(this.label);
  }

  async fetchResults() {
    const res = await fetch(`${this.baseUrl}/api/session/${this.sessionId}/results`);
    if (res.ok) {
      this.results = await res.json();
    }
    return this.results;
  }

  getReport() {
    const totalAnswers = this.players.reduce((s, p) => s + p.answeredCount, 0);
    const allErrors = this.players.flatMap(p => p.errors);
    const finishedCount = this.players.filter(p => p.finished).length;
    return {
      label: this.label,
      joinCode: this.joinCode,
      sessionId: this.sessionId,
      totalPlayers: this.players.length,
      finishedPlayers: finishedCount,
      totalAnswers,
      errors: allErrors,
      playerDetails: this.players.map(p => ({
        name: p.name,
        answered: p.answeredCount,
        questionsReceived: p.questionsReceived.length,
        finished: p.finished,
        reconnects: p.reconnectCount,
        reconnectEnabled: p.reconnectEnabled,
        errors: p.errors
      }))
    };
  }

  cleanup() {
    this.players.forEach(p => p.disconnect());
  }
}

// ── Progress Tracker ─────────────────────────────────────────────────────────

class ProgressTracker {
  constructor(numSessions, totalQuestions) {
    this.numSessions = numSessions;
    this.totalQuestions = totalQuestions;
    this.sessionStates = new Map(); // label -> { question, answers, totalPlayers, phase, finished }
    this.startTime = Date.now();
  }

  _elapsed() {
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m${(s % 60).toString().padStart(2, '0')}s` : `${s}s`;
  }

  _initSession(label) {
    if (!this.sessionStates.has(label)) {
      this.sessionStates.set(label, { question: 0, answers: 0, totalPlayers: 0, phase: 'waiting', finished: false });
    }
  }

  onQuestion(label, questionNum, questionText) {
    this._initSession(label);
    const state = this.sessionStates.get(label);
    state.question = questionNum;
    state.answers = 0;
    state.phase = 'answering';
    const preview = questionText.length > 40 ? questionText.substring(0, 40) + '...' : questionText;
    console.log(`  [${this._elapsed()}] [${label}] 📝 Q${questionNum}/${this.totalQuestions}: "${preview}"`);
  }

  onAnswer(label, answeredCount, totalPlayers) {
    this._initSession(label);
    const state = this.sessionStates.get(label);
    state.answers = answeredCount;
    state.totalPlayers = totalPlayers;
    // Log at milestones: first, halfway, all
    if (answeredCount === 1 || answeredCount === Math.ceil(totalPlayers / 2) || answeredCount === totalPlayers) {
      console.log(`  [${this._elapsed()}] [${label}]    ✏️  ${answeredCount}/${totalPlayers} answered`);
    }
  }

  onPhase(label, phase) {
    this._initSession(label);
    const state = this.sessionStates.get(label);
    state.phase = phase;
    const phaseLabels = { correct_answer: '✅ Correct answer reveal', scoreboard: '📊 Scoreboard', get_ready: '🏁 Get ready', reconnected: '🔄 Player reconnected', disconnecting: '🔌 Player disconnecting', state_synced: '🔄 State synced after rejoin' };
    console.log(`  [${this._elapsed()}] [${label}]    ${phaseLabels[phase] || phase}`);
  }

  onFinished(label) {
    this._initSession(label);
    const state = this.sessionStates.get(label);
    state.finished = true;
    state.phase = 'finished';
    const done = [...this.sessionStates.values()].filter(s => s.finished).length;
    console.log(`  [${this._elapsed()}] [${label}] 🏁 Finished (${done}/${this.numSessions} sessions done)`);
  }
}

// ── Quiz Creation ────────────────────────────────────────────────────────────

async function createQuiz() {
  console.log('🎯 Creating shared test quiz...');
  const createRes = await fetch(`${BASE_URL}/api/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ title: `Parallel Stress Test ${new Date().toISOString()}` })
  });
  if (!createRes.ok) throw new Error(`Failed to create quiz: ${await createRes.text()}`);
  const quiz = await createRes.json();

  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const q = TEST_QUESTIONS[i];
    const addRes = await fetch(`${BASE_URL}/api/quiz/${quiz.adminToken}/question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...q, sortOrder: i })
    });
    if (!addRes.ok) throw new Error(`Failed to add question ${i + 1}`);
  }

  console.log(`✅ Quiz created with ${TEST_QUESTIONS.length} questions (token: ${quiz.adminToken})\n`);
  return { adminToken: quiz.adminToken, quizId: quiz.quizId };
}

async function createSessions(adminToken, count) {
  console.log(`📋 Creating ${count} sessions from the same quiz...`);
  const sessions = [];

  for (let i = 0; i < count; i++) {
    const res = await fetch(`${BASE_URL}/api/quiz/${adminToken}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionName: `Parallel Test ${i + 1}`,
        useTimers: true,
        answerTimeSeconds: ANSWER_TIME,
        scoreboardPauseSeconds: SCOREBOARD_PAUSE
      })
    });
    if (!res.ok) throw new Error(`Failed to create session ${i + 1}`);
    const data = await res.json();
    sessions.push(data);
    console.log(`  Session ${i + 1}: ${data.joinCode} (${data.sessionId})`);
  }

  console.log(`✅ Created ${count} sessions\n`);
  return sessions;
}

// ── Isolation Verification ───────────────────────────────────────────────────

function verifyIsolation(reports) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🔍 ISOLATION VERIFICATION');
  console.log(`${'='.repeat(60)}\n`);

  let allPassed = true;

  for (const report of reports) {
    const issues = [];

    // Check all players finished
    if (report.finishedPlayers < report.totalPlayers) {
      issues.push(`Only ${report.finishedPlayers}/${report.totalPlayers} players finished`);
    }

    // Check every player received questions
    for (const p of report.playerDetails) {
      if (p.questionsReceived === 0) {
        issues.push(`${p.name} received 0 questions`);
      }
      if (p.errors.length > 0) {
        issues.push(`${p.name} had ${p.errors.length} errors: ${p.errors.join('; ')}`);
      }
    }

    // Check player names belong to this session only
    for (const p of report.playerDetails) {
      if (!p.name.startsWith(report.label)) {
        issues.push(`Player ${p.name} doesn't belong to session ${report.label}`);
      }
    }

    if (issues.length === 0) {
      const reconnecters = report.playerDetails.filter(p => p.reconnects > 0);
      const reconnectInfo = reconnecters.length > 0
        ? `, ${reconnecters.length} reconnected (${reconnecters.reduce((s, p) => s + p.reconnects, 0)} total reconnects)`
        : '';
      console.log(`✅ ${report.label} (${report.joinCode}): PASSED`);
      console.log(`   ${report.totalPlayers} players, ${report.totalAnswers} answers, ${report.finishedPlayers} finished${reconnectInfo}`);
    } else {
      console.log(`❌ ${report.label} (${report.joinCode}): ISSUES FOUND`);
      issues.forEach(i => console.log(`   ⚠️  ${i}`));
      allPassed = false;
    }
  }

  // Cross-session check: ensure player names don't appear in other sessions
  const allPlayerNames = new Set();
  for (const report of reports) {
    for (const p of report.playerDetails) {
      if (allPlayerNames.has(p.name)) {
        console.log(`\n❌ CROSS-SESSION CONTAMINATION: ${p.name} appears in multiple sessions!`);
        allPassed = false;
      }
      allPlayerNames.add(p.name);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (allPassed) {
    console.log('✅ ALL ISOLATION CHECKS PASSED');
  } else {
    console.log('❌ SOME ISOLATION CHECKS FAILED');
  }
  console.log(`${'─'.repeat(60)}\n`);

  return allPassed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function cleanupQuiz(adminToken) {
  console.log('\n🧹 Cleaning up test data...');
  try {
    const res = await fetch(`${BASE_URL}/api/quiz/${adminToken}`, { method: 'DELETE' });
    if (res.ok) {
      console.log('✅ Test quiz and all sessions deleted');
    } else {
      console.log(`⚠️  Cleanup failed: ${res.status} ${await res.text()}`);
    }
  } catch (error) {
    console.log(`⚠️  Cleanup error: ${error.message}`);
  }
}

async function main() {
  let adminToken = null;
  try {
    // 1. Create shared quiz
    const quizData = await createQuiz();
    adminToken = quizData.adminToken;

    // 2. Create N sessions
    const sessionData = await createSessions(adminToken, NUM_SESSIONS);

    // 3. Create session runners with progress tracking
    const progressTracker = new ProgressTracker(NUM_SESSIONS, TEST_QUESTIONS.length);
    const runners = sessionData.map((s, i) =>
      new SessionRunner(i, s.sessionId, s.joinCode, adminToken, BASE_URL, progressTracker)
    );

    // 4. Setup players (register + connect) for all sessions in parallel
    console.log('👥 Setting up players for all sessions...');
    await Promise.all(runners.map(r => r.setup(PLAYERS_PER_SESSION)));
    console.log('');

    // 5. Start sessions
    if (AUTO_ADVANCE) {
      console.log('▶️  Auto-starting all sessions...');
      // Small stagger to simulate realistic start pattern
      for (const runner of runners) {
        await runner.start();
      }
      console.log('');

      // 6. Wait for all sessions to finish
      console.log('\n⏳ Live progress:\n');
      await Promise.all(runners.map(r => r.waitForFinish()));
      console.log('');

      // 7. Collect reports and verify isolation
      const reports = runners.map(r => r.getReport());

      // Print summary
      console.log(`${'='.repeat(60)}`);
      console.log('📊 SESSION SUMMARY');
      console.log(`${'='.repeat(60)}\n`);

      for (const report of reports) {
        console.log(`${report.label} (${report.joinCode}):`);
        console.log(`  Players: ${report.totalPlayers}, Finished: ${report.finishedPlayers}, Answers: ${report.totalAnswers}`);
        if (report.errors.length > 0) {
          console.log(`  Errors: ${report.errors.length}`);
        }
      }

      const passed = verifyIsolation(reports);

      // Cleanup
      runners.forEach(r => r.cleanup());
      await cleanupQuiz(adminToken);
      process.exit(passed ? 0 : 1);
    } else {
      // Manual mode: just print URLs and wait
      console.log(`${'='.repeat(60)}`);
      console.log('📺 SESSIONS READY - Start them manually:');
      console.log(`${'='.repeat(60)}\n`);

      const publicUrl = BASE_URL.replace('http://quiz:3042', 'https://quiz.zikkan.com')
                                .replace('http://nginx', 'https://quiz.zikkan.com')
                                .replace('http://localhost:3042', 'http://localhost');

      for (const runner of runners) {
        console.log(`${runner.label}:`);
        console.log(`  Host: ${publicUrl}/host/${runner.sessionId}?token=${adminToken}`);
        console.log(`  Display: ${publicUrl}/display/${runner.sessionId}?token=${adminToken}`);
        console.log('');
      }

      console.log('Press Ctrl+C to stop.\n');

      process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        runners.forEach(r => r.cleanup());
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    if (adminToken) await cleanupQuiz(adminToken);
    process.exit(1);
  }
}

main();
