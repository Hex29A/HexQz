import db from '../db/db.js';

export default function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // Participant joins session room
    socket.on('join:session', ({ sessionId, participantId }) => {
      if (!sessionId || !participantId) return;

      // Validate participant belongs to session
      const participant = db.prepare('SELECT * FROM participant WHERE id = ? AND session_id = ?').get(participantId, sessionId);
      if (!participant) return;

      socket.join(`session:${sessionId}`);
      socket.data = { sessionId, participantId, role: 'participant' };
    });

    // Host joins session room
    socket.on('host:session', ({ sessionId, adminToken }) => {
      if (!sessionId || !adminToken) return;

      // Validate admin token matches the session's quiz
      const session = db.prepare(`
        SELECT s.*, q.admin_token FROM session s
        JOIN quiz q ON q.id = s.quiz_id
        WHERE s.id = ?
      `).get(sessionId);

      if (!session || session.admin_token !== adminToken) return;

      socket.join(`session:${sessionId}`);
      socket.data = { sessionId, adminToken, role: 'host' };
    });

    // Rejoin on reconnect — full state sync
    socket.on('rejoin:session', ({ sessionId, participantId }) => {
      if (!sessionId) return;

      // Validate
      if (participantId) {
        const participant = db.prepare('SELECT * FROM participant WHERE id = ? AND session_id = ?').get(participantId, sessionId);
        if (!participant) return;
      }

      socket.join(`session:${sessionId}`);

      // Build full state
      const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId);
      if (!session) return;

      const questions = db.prepare('SELECT * FROM question WHERE quiz_id = ? ORDER BY sort_order').all(session.quiz_id);
      const scores = db.prepare(`
        SELECT display_name, team_name, score FROM participant
        WHERE session_id = ? ORDER BY score DESC
      `).all(sessionId).map(p => ({ name: p.display_name, team: p.team_name, score: p.score }));

      if (session.status === 'waiting') {
        socket.emit('session:state', {
          status: 'waiting',
          questionIndex: 0,
          totalQuestions: questions.length,
          scores
        });
        return;
      }

      if (session.status === 'finished') {
        socket.emit('session:state', {
          status: 'finished',
          questionIndex: questions.length,
          totalQuestions: questions.length,
          scores
        });
        return;
      }

      // Active
      const currentQuestion = questions[session.current_question_index];
      if (!currentQuestion) return;

      const answers = db.prepare('SELECT * FROM answer WHERE question_id = ?').all(currentQuestion.id);

      socket.emit('session:state', {
        status: 'active',
        question: { id: currentQuestion.id, text: currentQuestion.text, imageUrl: currentQuestion.image_url, type: currentQuestion.type },
        answers: answers.map(a => ({ id: a.id, text: a.text })),
        questionIndex: session.current_question_index,
        totalQuestions: questions.length,
        scores
      });
    });
  });
}
