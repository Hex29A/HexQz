import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSessionSocket, { socket } from '../hooks/useSessionSocket.js';
import { applyTheme } from '../theme.js';

export default function LobbyView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const participantId = localStorage.getItem(`participant:${sessionId}`);
  const participantSecret = localStorage.getItem(`participantSecret:${sessionId}`);
  const displayName = localStorage.getItem(`participantName:${sessionId}`);
  const [participantCount, setParticipantCount] = useState(0);
  const [cover, setCover] = useState({ imageUrl: null, text: null });

  const applyState = useCallback((data) => {
    if (!data || data.error) return;
    if (data.themeColor) applyTheme(data.themeColor, data.lightMode);
    if (data.status === 'active') navigate(`/game/${sessionId}`);
    if (data.status === 'finished') navigate(`/results/${sessionId}`);
    if (data.participants) setParticipantCount(data.participants.length);
    if (data.status === 'waiting') setCover({ imageUrl: data.coverImageUrl || null, text: data.coverText || null });
  }, [navigate, sessionId]);

  useEffect(() => { if (!participantId || !participantSecret) navigate('/join'); }, [participantId, participantSecret, navigate]);

  useSessionSocket({
    enabled: !!(participantId && participantSecret),
    deps: [sessionId],
    join: () => socket.emit('join:session', { sessionId, participantId, participantSecret }),
    handlers: {
      'session:state': applyState,
      'session:participant_joined': () => setParticipantCount(prev => prev + 1),
      'session:get_ready': () => navigate(`/game/${sessionId}`),
      'session:reset': () => {
        localStorage.removeItem(`participant:${sessionId}`);
        localStorage.removeItem(`participantSecret:${sessionId}`);
        navigate('/join');
      }
    }
  });

  useEffect(() => {
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(applyState).catch(() => {});
  }, [sessionId, applyState]);

  const hasCover = cover.imageUrl || cover.text;
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
      {cover.imageUrl && <img src={cover.imageUrl} alt="" className="w-full max-w-md max-h-[45vh] object-contain rounded-2xl shadow-2xl mb-5" />}
      {cover.text && <h2 className="text-2xl font-bold text-accent mb-5">{cover.text}</h2>}
      {!hasCover && <div className="animate-pulse text-6xl mb-6">🎯</div>}
      <h1 className="text-3xl font-bold mb-4">{displayName ? `Hi ${displayName}, you're in!` : "You're in!"}</h1>
      <p className="text-text-secondary text-lg">Waiting for the host to start...</p>
      {participantCount > 0 && (
        <p className="text-text-secondary mt-4">{participantCount} player{participantCount !== 1 ? 's' : ''} ready</p>
      )}
    </div>
  );
}
