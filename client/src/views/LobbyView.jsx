import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket.js';

export default function LobbyView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const participantId = localStorage.getItem(`participant:${sessionId}`);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    if (!participantId) {
      navigate('/join');
      return;
    }

    socket.connect();
    socket.emit('join:session', { sessionId, participantId });

    socket.on('connect', () => {
      socket.emit('rejoin:session', { sessionId, participantId });
    });

    socket.on('session:participant_joined', () => {
      setParticipantCount(prev => prev + 1);
    });

    socket.on('session:started', () => {
      navigate(`/game/${sessionId}`);
    });

    socket.on('session:state', (data) => {
      if (data.status === 'active') navigate(`/game/${sessionId}`);
      if (data.status === 'finished') navigate(`/results/${sessionId}`);
    });

    // Initial state check
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      if (data.status === 'active') navigate(`/game/${sessionId}`);
      if (data.status === 'finished') navigate(`/results/${sessionId}`);
      if (data.participants) setParticipantCount(data.participants.length);
    });

    return () => {
      socket.off('session:participant_joined');
      socket.off('session:started');
      socket.off('session:state');
    };
  }, [sessionId, participantId, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="animate-pulse text-6xl mb-6">🎯</div>
      <h1 className="text-3xl font-bold mb-4">You're in!</h1>
      <p className="text-gray-400 text-lg">Waiting for the host to start...</p>
      {participantCount > 0 && (
        <p className="text-gray-500 mt-4">{participantCount} player{participantCount !== 1 ? 's' : ''} ready</p>
      )}
    </div>
  );
}
