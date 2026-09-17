import db from '../db/db.js';
import { authenticateParticipant } from '../routes/join.js';
import { buildSessionState } from '../engine.js';

// Every handshake answers with the same full projection (session:state) so a
// reloaded host, display or player view can rebuild itself from one event.
export default function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const sendState = (sessionId) => {
      const state = buildSessionState(sessionId);
      if (state) socket.emit('session:state', state);
    };

    socket.on('join:session', ({ sessionId, participantId, participantSecret } = {}) => {
      if (!sessionId || !participantId) return;
      const participant = authenticateParticipant(participantId, participantSecret);
      if (!participant || participant.session_id !== sessionId) return;
      socket.join(`session:${sessionId}`);
      socket.data = { sessionId, participantId, role: 'participant' };
      sendState(sessionId);
    });

    socket.on('host:session', ({ sessionId, adminToken } = {}) => {
      if (!sessionId || !adminToken) return;
      const session = db.prepare(`
        SELECT s.id, q.admin_token FROM session s
        JOIN quiz q ON q.id = s.quiz_id
        WHERE s.id = ?
      `).get(sessionId);
      if (!session || session.admin_token !== adminToken) return;
      socket.join(`session:${sessionId}`);
      socket.data = { sessionId, role: 'host' };
      sendState(sessionId);
    });

    // Read-only spectator (display screen, results page) or a returning
    // player. Everything in session:state is public information.
    socket.on('rejoin:session', ({ sessionId, participantId, participantSecret } = {}) => {
      if (!sessionId) return;
      if (participantId) {
        const participant = authenticateParticipant(participantId, participantSecret);
        if (!participant || participant.session_id !== sessionId) return;
        socket.data = { sessionId, participantId, role: 'participant' };
      } else if (!socket.data?.role) {
        socket.data = { sessionId, role: 'spectator' };
      }
      if (!db.prepare('SELECT id FROM session WHERE id = ?').get(sessionId)) return;
      socket.join(`session:${sessionId}`);
      sendState(sessionId);
    });
  });
}
