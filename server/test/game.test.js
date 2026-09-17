import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { startServer, api, waitFor, sleep, ADMIN_SECRET } from './helpers.js';

let server, c, db;
const secretHeader = { 'x-admin-secret': ADMIN_SECRET };

before(async () => {
  server = await startServer();
  c = api(server.base);
  db = new Database(server.dbPath, { readonly: true });
});
after(async () => { db?.close(); await server?.stop(); });

async function createQuiz() {
  const r = await c.post('/quiz', { title: 'Testquiz' }, secretHeader);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.adminToken;
}

async function addEstimation(token, correctValue) {
  const r = await c.post(`/quiz/${token}/question`, { text: 'Uppskatta', type: 'estimation', correctValue, answers: [] });
  assert.equal(r.status, 201);
  return r.body.questionId;
}

async function addSingleChoice(token) {
  const r = await c.post(`/quiz/${token}/question`, {
    text: 'Huvudstad?', type: 'single_choice',
    answers: [{ text: 'Paris', isCorrect: true }, { text: 'Oslo', isCorrect: false }]
  });
  assert.equal(r.status, 201);
  return r.body.questionId;
}

async function createSession(token, opts = {}) {
  const r = await c.post(`/quiz/${token}/session`, { useTimers: false, ...opts });
  assert.equal(r.status, 201);
  return r.body;
}

async function register(joinCode, displayName) {
  const r = await c.post(`/join/${joinCode}/register`, { displayName });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.participantSecret, 'registration returns a secret');
  return { participantId: r.body.participantId, participantSecret: r.body.participantSecret };
}

function answer(who, questionId, payload) {
  return c.post('/answer', { ...who, questionId, ...payload });
}

async function start(sessionId, token) {
  const r = await c.post(`/session/${sessionId}/start`, {}, { 'x-admin-token': token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return waitFor(c, sessionId, s => s.currentPhase === 'question');
}

function scoresByName(state) {
  return Object.fromEntries(state.scores.map(s => [s.name, s.score]));
}

test('#6: /api/status is gone', async () => {
  const r = await c.get('/status');
  assert.equal(r.status, 404);
});

test('#10: creating a quiz requires the admin secret', async () => {
  const r = await c.post('/quiz', { title: 'Öppet?' });
  assert.equal(r.status, 401);
  const r2 = await c.post('/quiz', { title: 'Fel' }, { 'x-admin-secret': 'wrong' });
  assert.equal(r2.status, 401);
});

test('#10: upload requires admin secret or a valid quiz token', async () => {
  const r = await fetch(server.base + '/api/upload', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('#2: admin cookie is a random session token, not the secret', async () => {
  const login = await c.post('/admin/login', { password: ADMIN_SECRET });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.ok(cookie.startsWith('admin_session='));
  const tokenValue = cookie.split(';')[0].split('=')[1];
  assert.notEqual(tokenValue, ADMIN_SECRET);
  assert.equal(tokenValue.length, 64);
  // token works, the raw secret in the cookie does not
  const ok = await c.get('/admin/quizzes', { Cookie: `admin_session=${tokenValue}` });
  assert.equal(ok.status, 200);
  const bad = await c.get('/admin/quizzes', { Cookie: `admin_session=${ADMIN_SECRET}` });
  assert.equal(bad.status, 401);
  // logout revokes
  const out = await c.post('/admin/logout', {}, { Cookie: `admin_session=${tokenValue}` });
  assert.equal(out.status, 200);
  const after = await c.get('/admin/quizzes', { Cookie: `admin_session=${tokenValue}` });
  assert.equal(after.status, 401);
});

test('#3: admin login is rate limited', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await c.post('/admin/login', { password: 'nope' });
  }
  assert.equal(last.status, 429);
});

test('#16 #9 #7 #19 #18: full game flow scores correctly', async () => {
  const token = await createQuiz();
  const estimationId = await addEstimation(token, 100);
  const choiceId = await addSingleChoice(token);
  const s1 = await createSession(token);
  const [a, b, cId] = await Promise.all(['Anna', 'Bo', 'Cia'].map(n => register(s1.joinCode, n)));

  const state = await start(s1.sessionId, token);
  assert.equal(state.question.id, estimationId);
  // #7: no answer key while the question is open
  assert.equal(state.question.correctValue, null);

  // #9: revising an answer must not keep the earlier (faster) response time
  await answer(a, estimationId, { textAnswer: '5' });
  const firstTime = db.prepare('SELECT response_time_ms FROM response WHERE participant_id = ?').get(a.participantId).response_time_ms;
  await sleep(400);
  await answer(a, estimationId, { textAnswer: '100' });
  const secondTime = db.prepare('SELECT response_time_ms FROM response WHERE participant_id = ?').get(a.participantId).response_time_ms;
  assert.ok(secondTime >= firstTime + 300, `revised time ${secondTime} should be later than ${firstTime}`);

  // #8: answering as someone else (right id, wrong secret) is rejected
  const spoof = await c.post('/answer', { participantId: b.participantId, participantSecret: a.participantSecret, questionId: estimationId, textAnswer: '1' });
  assert.equal(spoof.status, 403);
  const noSecret = await c.post('/answer', { participantId: b.participantId, questionId: estimationId, textAnswer: '1' });
  assert.equal(noSecret.status, 403);

  await answer(b, estimationId, { textAnswer: '90' });
  await answer(cId, estimationId, { textAnswer: '50' });

  // All answered -> early close -> estimation scored
  const closed = await waitFor(c, s1.sessionId, s => s.currentPhase !== 'question');
  assert.equal(closed.question.correctValue, 100, '#7: answer key revealed after close');

  // #16: exactly 1200 / 800 / 600, not multiplied by the number of questions
  const scores = scoresByName(closed);
  assert.deepEqual(scores, { Anna: 1200, Bo: 800, Cia: 600 });

  // #16: a second session on the same quiz is scored independently
  const s2 = await createSession(token);
  const d = await register(s2.joinCode, 'Dan');
  await start(s2.sessionId, token);
  await answer(d, estimationId, { textAnswer: '100' });
  const closed2 = await waitFor(c, s2.sessionId, s => s.currentPhase !== 'question');
  assert.deepEqual(scoresByName(closed2), { Dan: 1200 });
  const s1Again = (await c.get(`/session/${s1.sessionId}/current`)).body;
  assert.deepEqual(scoresByName(s1Again), { Anna: 1200, Bo: 800, Cia: 600 }, 'session 1 untouched by session 2');

  // Move session 1 on to the single-choice question
  await waitFor(c, s1.sessionId, s => ['scoreboard', 'waiting_for_continue'].includes(s.currentPhase), 15000);
  const cont = await c.post(`/session/${s1.sessionId}/continue`, {}, { 'x-admin-token': token });
  assert.equal(cont.status, 200);
  const q2 = await waitFor(c, s1.sessionId, s => s.currentPhase === 'question' && s.question.id === choiceId);
  const wrong = q2.answers.find(x => x.text === 'Oslo');
  await answer(cId, choiceId, { answerId: wrong.id });

  // #19: override awards on the session's scale (untimed => 1 point), not a flat 10
  const responses = await c.get(`/session/${s1.sessionId}/question/${choiceId}/responses`, { 'x-admin-token': token });
  assert.equal(responses.status, 200);
  const ciaResponse = responses.body.find(r => r.displayName === 'Cia');
  const ov = await c.post(`/session/${s1.sessionId}/override`, { responseId: ciaResponse.id, isCorrect: true }, { 'x-admin-token': token });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.pointsDiff, 1);

  // #18: editing and deleting a question that already has responses works
  const edit = await c.put(`/quiz/${token}/question/${choiceId}`, {
    text: 'Huvudstad i Frankrike?', type: 'single_choice',
    answers: [{ text: 'Paris', isCorrect: true }, { text: 'Lyon', isCorrect: false }]
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const del = await c.del(`/quiz/${token}/question/${estimationId}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM response WHERE question_id = ?').get(estimationId).c, 0);
  // Session cascade: deleting a session removes its participants and responses
  const delSession = await c.del(`/quiz/${token}/session/${s2.sessionId}`);
  assert.equal(delSession.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participant WHERE session_id = ?').get(s2.sessionId).c, 0);
});

test('#8: duplicate name does not leak the existing participant id', async () => {
  const token = await createQuiz();
  const s = await createSession(token);
  await register(s.joinCode, 'Eva');
  const dup = await c.post(`/join/${s.joinCode}/register`, { displayName: 'Eva' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.participantId, undefined);
  // resume check needs the secret
  const state = (await c.get(`/session/${s.sessionId}/current`)).body;
  assert.ok(state.participants.every(p => p.id === undefined), 'no ids in public participant list');
});

test('#18: migration rebuilds tables with ON DELETE rules', () => {
  const fks = db.pragma('foreign_key_list(response)');
  const q = fks.find(f => f.table === 'question');
  const ans = fks.find(f => f.table === 'answer');
  assert.equal(q.on_delete, 'CASCADE');
  assert.equal(ans.on_delete, 'SET NULL');
});
