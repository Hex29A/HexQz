import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { applyTheme } from '../theme.js';

export default function JoinView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState('code'); // 'code' | 'name'
  const [joinCode, setJoinCode] = useState(searchParams.get('code') || '');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Auto-validate if code was passed via URL
    if (searchParams.get('code')) {
      validateCode(searchParams.get('code'));
    }
  }, []);

  const validateCode = async (code) => {
    setError('');
    const res = await fetch(`/api/join/${code.toUpperCase()}`);
    if (res.ok) {
      const data = await res.json();
      setSessionInfo(data);
      if (data.themeColor) {
        applyTheme(data.themeColor, data.lightMode);
      }
      // Check if we already have a participantId for this session (auto-resume)
      const savedPid = localStorage.getItem(`participant:${data.sessionId}`);
      if (savedPid) {
        navigate(data.status === 'waiting' ? `/lobby/${data.sessionId}` : `/game/${data.sessionId}`);
        return;
      }
      setStep('name');
    } else {
      const err = await res.json();
      setError(err.error || 'Invalid code');
    }
  };

  const handleCodeSubmit = (e) => {
    e.preventDefault();
    if (joinCode.trim().length > 0) validateCode(joinCode.trim());
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) return;

    const res = await fetch(`/api/join/${joinCode.toUpperCase()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayName.trim(), teamName: teamName.trim() || undefined })
    });

    if (res.ok) {
      const { participantId, sessionId } = await res.json();
      localStorage.setItem(`participant:${sessionId}`, participantId);
      navigate(`/lobby/${sessionId}`);
    } else if (res.status === 409) {
      // Name already taken — resume as that participant
      const { participantId, sessionId } = await res.json();
      localStorage.setItem(`participant:${sessionId}`, participantId);
      navigate(sessionInfo?.status === 'waiting' ? `/lobby/${sessionId}` : `/game/${sessionId}`);
    } else {
      const err = await res.json();
      setError(err.error || 'Registration failed');
    }
  };

  if (step === 'code') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <h1 className="text-3xl font-bold mb-6">Join Quiz</h1>
        <form onSubmit={handleCodeSubmit} className="w-full max-w-sm flex flex-col gap-3">
          <input
            type="text"
            placeholder="Enter join code"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest bg-bg-card border border-border-theme rounded-lg focus:outline-none focus:border-accent uppercase"
            autoFocus
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" className="w-full py-3 bg-accent hover:opacity-90 rounded-lg font-semibold text-lg transition">
            Join
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <h1 className="text-3xl font-bold mb-2">{sessionInfo?.quizTitle || 'Join Quiz'}</h1>
      <p className="text-text-secondary mb-6">Enter your name to join</p>
      <form onSubmit={handleRegister} className="w-full max-w-sm flex flex-col gap-3">
        <input
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={30}
          className="w-full px-4 py-3 bg-bg-card border border-border-theme rounded-lg focus:outline-none focus:border-accent"
          autoFocus
        />
        <input
          type="text"
          placeholder="Team name (optional)"
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          maxLength={30}
          className="w-full px-4 py-3 bg-bg-card border border-border-theme rounded-lg focus:outline-none focus:border-accent"
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button type="submit" className="w-full py-3 bg-accent hover:opacity-90 rounded-lg font-semibold text-lg transition">
          Ready!
        </button>
      </form>
    </div>
  );
}
