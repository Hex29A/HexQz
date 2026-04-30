import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LandingView() {
  const [status, setStatus] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    if (joinCode.trim().length > 0) {
      navigate(`/join?code=${joinCode.trim().toUpperCase()}`);
    }
  };

  if (!status) return <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-2xl">Loading...</div></div>;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">hexqz</h1>

      {status.active ? (
        <div className="mt-8 w-full max-w-sm">
          <p className="text-gray-400 text-center mb-4">
            {status.sessions.length === 1
              ? `"${status.sessions[0].quizTitle}" is live!`
              : `${status.sessions.length} quizzes are live!`}
          </p>
          <form onSubmit={handleJoin} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Enter join code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-accent uppercase"
              autoFocus
            />
            <button type="submit" className="w-full py-3 bg-accent hover:opacity-90 rounded-lg font-semibold text-lg transition">
              Join Quiz
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-8 text-center">
          <div className="text-6xl mb-4">🎯</div>
          <p className="text-gray-400 text-xl">No quiz at the moment</p>
          <p className="text-gray-600 mt-2">Check back later or ask the host for a join code</p>
        </div>
      )}
    </div>
  );
}
