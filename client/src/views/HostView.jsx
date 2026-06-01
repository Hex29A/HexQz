import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../socket.js';
import Scoreboard from '../components/Scoreboard.jsx';

export default function HostView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const adminToken = searchParams.get('token');
  const [state, setState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [answerCount, setAnswerCount] = useState({ count: 0, total: 0, answered: [], waiting: [] });
  const [scores, setScores] = useState([]);
  const [started, setStarted] = useState(false);
  const [inControlPanel, setInControlPanel] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [finished, setFinished] = useState(false);
  const [connected, setConnected] = useState(true);
  const [showReview, setShowReview] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [reviewQuestionId, setReviewQuestionId] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [answerTimeSeconds, setAnswerTimeSeconds] = useState(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(null);
  const [sessionName, setSessionName] = useState('');
  const [waitingForContinue, setWaitingForContinue] = useState(false);
  const [currentPhase, setCurrentPhase] = useState(null);
  const [questionStats, setQuestionStats] = useState(null);
  const [roundWinner, setRoundWinner] = useState(null);
  const [nextQuestion, setNextQuestion] = useState(null);

  useEffect(() => {
    // Load initial state
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      setState(data);
      setScores(data.scores || []);
      if (data.participants) setParticipants(data.participants);
      if (data.answerTimeSeconds) setAnswerTimeSeconds(data.answerTimeSeconds);
      if (data.sessionName) setSessionName(data.sessionName);
      
      // Restore phase state
      if (data.currentPhase) {
        setCurrentPhase(data.currentPhase);
      }
      
      if (data.status === 'active') {
        setStarted(true);
        setCurrentQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
        if (data.questionStartedAt) setQuestionStartedAt(data.questionStartedAt);
        
        // If in a result phase, request the latest state from server
        if (data.currentPhase && data.currentPhase !== 'question') {
          socket.connect();
          socket.emit('host:session', { sessionId, adminToken });
        }
      }
      if (data.status === 'finished') {
        setFinished(true);
        if (data.questions) setQuestions(data.questions);
      }
    });

    // Socket
    socket.connect();
    socket.emit('host:session', { sessionId, adminToken });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('host:session', { sessionId, adminToken });
      // Full state re-sync on reconnect
      fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
        setScores(data.scores || []);
        if (data.participants) setParticipants(data.participants);
        
        // Restore phase state
        if (data.currentPhase) {
          setCurrentPhase(data.currentPhase);
        }
        
        if (data.status === 'active') {
          setStarted(true);
          setCurrentQuestion(data.question);
          setQuestionIndex(data.questionIndex);
          setTotalQuestions(data.totalQuestions);
        }
        if (data.status === 'finished') {
          setFinished(true);
          if (data.questions) setQuestions(data.questions);
        }
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('session:participant_joined', (p) => {
      setParticipants(prev => [...prev, p]);
    });

    socket.on('session:started', (data) => {
      setStarted(true);
      setCurrentQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setAnswerCount({ count: 0, total: 0, answered: [], waiting: [] });
      if (data.questionStartedAt) setQuestionStartedAt(data.questionStartedAt);
      if (data.answerTimeSeconds !== undefined) setAnswerTimeSeconds(data.answerTimeSeconds);
      setWaitingForContinue(false);
      setCurrentPhase(null);
      setQuestionStats(null);
      setRoundWinner(null);
      setNextQuestion(null);
    });

    socket.on('session:get_ready', (data) => {
      setStarted(true);
      if (data.totalQuestions) setTotalQuestions(data.totalQuestions);
      // Clear result states - we're moving to next question
      setWaitingForContinue(false);
      setCurrentPhase('get_ready');
      setQuestionStats(null);
      setRoundWinner(null);
      setTimeRemaining(null);
    });

    socket.on('session:question', (data) => {
      setStarted(true);
      setCurrentQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setAnswerCount({ count: 0, total: 0, answered: [], waiting: [] });
      if (data.questionStartedAt) setQuestionStartedAt(data.questionStartedAt);
      if (data.answerTimeSeconds !== undefined) setAnswerTimeSeconds(data.answerTimeSeconds);
      setWaitingForContinue(false);
      setCurrentPhase(null);
      setQuestionStats(null);
      setRoundWinner(null);
      setNextQuestion(null);
    });

    socket.on('session:answer_count', (data) => {
      setAnswerCount({ count: data.count, total: data.total, answered: data.answered || [], waiting: data.waiting || [] });
    });

    socket.on('session:scores', (data) => {
      setScores(data.scores);
      setCurrentPhase('scoreboard');
    });

    socket.on('session:waiting_for_continue', (data) => {
      setWaitingForContinue(true);
      setCurrentPhase(null);
      if (data.nextQuestion) setNextQuestion(data.nextQuestion);
      if (data.questionStats) {
        setQuestionStats(data.questionStats);
      }
    });

    socket.on('session:correct_answer', (data) => {
      setCurrentPhase('correct_answer');
      setQuestionStartedAt(null); // Stop the countdown timer
      // Set stats immediately when correct answer is shown
      if (data.question && data.correctAnswers !== undefined) {
        setQuestionStats({
          question: data.question,
          correctAnswers: data.correctAnswers,
          correctCount: data.correctCount,
          totalCount: data.totalCount
        });
      }
    });

    socket.on('session:round_result', (data) => {
      setCurrentPhase('round_result');
      setRoundWinner(data.winner || null);
    });

    socket.on('session:finished', (data) => {
      setFinished(true);
      setScores(data.results);
    });

    socket.on('session:reset', () => {
      // Another admin tab triggered reset — sync local state
      setFinished(false);
      setStarted(false);
      setParticipants([]);
      setScores([]);
      setCurrentQuestion(null);
      setQuestionIndex(0);
      setCurrentPhase(null);
      setWaitingForContinue(false);
      setRoundWinner(null);
      setQuestionStats(null);
      setTimeRemaining(null);
      setQuestionStartedAt(null);
      setAnswerCount({ count: 0, total: 0, answered: [], waiting: [] });
      // Fetch new join code
      fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
        if (data.joinCode) setJoinCodeDisplay(data.joinCode);
      });
    });

    socket.on('session:state', (data) => {
      setScores(data.scores || []);
      
      // Restore phase state
      if (data.currentPhase) {
        setCurrentPhase(data.currentPhase);
      }
      
      if (data.status === 'active') {
        setStarted(true);
        if (data.question) {
          setCurrentQuestion(data.question);
        }
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
      }
      if (data.status === 'finished') setFinished(true);
    });

    return () => {
      socket.off('session:participant_joined');
      socket.off('session:started');
      socket.off('session:get_ready');
      socket.off('session:question');
      socket.off('session:answer_count');
      socket.off('session:scores');
      socket.off('session:finished');
      socket.off('session:reset');
      socket.off('session:state');
      socket.off('session:waiting_for_continue');
      socket.off('session:correct_answer');
      socket.off('session:round_result');
      socket.off('session:scores');
      socket.off('disconnect');
      socket.disconnect();
    };
  }, [sessionId, adminToken]);

  // Timer effect for question phase (only when timed)
  useEffect(() => {
    if (started && !finished && questionStartedAt && answerTimeSeconds && currentQuestion) {
      const interval = setInterval(() => {
        const now = Date.now();
        const startTime = questionStartedAt * 1000;
        const elapsed = (now - startTime) / 1000;
        const remaining = Math.max(0, answerTimeSeconds - elapsed);
        
        setTimeRemaining(remaining);
        
        if (remaining <= 0) {
          clearInterval(interval);
        }
      }, 100);
      
      return () => clearInterval(interval);
    } else {
      setTimeRemaining(null);
    }
  }, [started, finished, questionStartedAt, answerTimeSeconds, currentQuestion]);

  const startQuiz = async () => {
    await fetch(`/api/session/${sessionId}/start`, {
      method: 'POST',
      headers: { 
        'X-Admin-Token': adminToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ autoMode: false })
    });
  };

  const [continuing, setContinuing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [closing, setClosing] = useState(false);

  const closeQuestion = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await fetch(`/api/session/${sessionId}/close-question`, {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken }
      });
    } catch (e) {
      console.error('Close question failed:', e);
    } finally {
      setTimeout(() => setClosing(false), 1000);
    }
  };

  const continueToNext = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/continue`, {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken }
      });
      if (!res.ok) {
        // Re-sync state from server
        const data = await fetch(`/api/session/${sessionId}/current`).then(r => r.json());
        if (data.currentPhase) setCurrentPhase(data.currentPhase);
        if (data.currentPhase !== 'waiting_for_continue') setWaitingForContinue(false);
      }
    } catch (e) {
      console.error('Continue failed:', e);
    } finally {
      // Reset after a delay to prevent rapid re-clicks
      setTimeout(() => setContinuing(false), 2000);
    }
  };

  const advancePhase = async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      await fetch(`/api/session/${sessionId}/advance-phase`, {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken }
      });
    } catch (e) {
      console.error('Advance failed:', e);
    } finally {
      setTimeout(() => setAdvancing(false), 500);
    }
  };

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join` : '';
  const [joinCodeDisplay, setJoinCodeDisplay] = useState('');

  const resetSession = async () => {
    if (!confirm('Reset this session? All players will be removed and a new join code will be generated.')) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/reset`, {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken }
      });
      if (res.ok) {
        const data = await res.json();
        // Reset all local state
        setFinished(false);
        setStarted(false);
        setParticipants([]);
        setScores([]);
        setCurrentQuestion(null);
        setQuestionIndex(0);
        setCurrentPhase(null);
        setWaitingForContinue(false);
        setRoundWinner(null);
        setQuestionStats(null);
        setTimeRemaining(null);
        setQuestionStartedAt(null);
        setAnswerCount({ count: 0, total: 0, answered: [], waiting: [] });
        if (data.joinCode) setJoinCodeDisplay(data.joinCode);
      }
    } catch (e) {
      console.error('Reset failed:', e);
    }
  };

  useEffect(() => {
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      if (data.joinCode) setJoinCodeDisplay(data.joinCode);
    });
  }, [sessionId]);

  if (finished) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <nav className="mb-6 text-sm text-gray-400">
          <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
          <span className="mx-2">/</span>
          <a href={`/admin/${adminToken}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${adminToken}`); }} className="hover:text-white transition">Quiz</a>
          <span className="mx-2">/</span>
          <span className="text-white">Session</span>
        </nav>
        {!connected && <div className="bg-red-900 text-red-200 text-center py-2 px-4 rounded-lg mb-4 text-sm">Reconnecting...</div>}
        <h1 className="text-3xl font-bold mb-6 text-center">Quiz Finished!</h1>
        <div className="mb-6 flex justify-center">
          <QRCodeSVG value={`${window.location.origin}/results/${sessionId}`} size={200} bgColor="transparent" fgColor="white" />
        </div>
        <p className="text-center text-gray-400 mb-2">Scan for results</p>
        <p className="text-center mb-6">
          <a href={`/results/${sessionId}`} className="text-accent hover:underline font-mono text-sm">{window.location.origin}/results/{sessionId}</a>
        </p>
        <Scoreboard scores={scores} />

        {questions.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold mb-4">Review Answers</h2>
            <div className="flex flex-col gap-2">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  onClick={() => { setReviewQuestionId(q.id); setShowReview(true); }}
                  className="text-left p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
                >
                  <span className="text-gray-400 text-sm mr-2">Q{i + 1}</span>
                  <span>{q.text}</span>
                  <span className="text-gray-500 text-xs ml-2">({q.type})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showReview && reviewQuestionId && (
          <ReviewPanel
            sessionId={sessionId}
            adminToken={adminToken}
            questionId={reviewQuestionId}
            onClose={() => { setShowReview(false); setReviewQuestionId(null); }}
          />
        )}

        <div className="mt-8 pt-6 border-t border-gray-700">
          <button onClick={resetSession} className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold transition">
            🔄 Reset Session (new join code, fresh start)
          </button>
        </div>
      </div>
    );
  }

  if (!started && !inControlPanel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <nav className="absolute top-4 left-4 text-sm text-gray-400">
          <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
          <span className="mx-2">/</span>
          <a href={`/admin/${adminToken}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${adminToken}`); }} className="hover:text-white transition">Quiz</a>
          <span className="mx-2">/</span>
          <span className="text-white">Lobby</span>
        </nav>
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <a 
            href="/admin"
            onClick={(e) => { e.preventDefault(); navigate('/admin'); }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold transition flex items-center gap-2"
          >
            🏠 Dashboard
          </a>
          <a 
            href={`/display/${sessionId}?token=${adminToken}`}
            target="_blank"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold transition flex items-center gap-2"
          >
            📺 Open Display View
          </a>
        </div>
        {sessionName && (
          <div className="mb-6">
            <h2 className="text-4xl font-bold text-accent text-center">{sessionName}</h2>
          </div>
        )}
        <h1 className="text-3xl font-bold mb-8">Session Lobby</h1>
        <div className="mb-4">
          <QRCodeSVG value={joinCodeDisplay ? `${joinUrl}?code=${joinCodeDisplay}` : joinUrl} size={250} bgColor="transparent" fgColor="white" />
        </div>
        {joinCodeDisplay && (
          <p className="text-4xl font-mono font-bold tracking-widest mb-4">{joinCodeDisplay}</p>
        )}
        <p className="text-gray-400 mb-2">Scan QR or enter code at <span className="text-white font-mono">{joinUrl}</span></p>
        <p className="text-gray-400 mb-2">{participants.length} player{participants.length !== 1 ? 's' : ''} joined</p>
        <p className="text-sm text-gray-500 mb-8">Players can join anytime - enter the host control panel to start</p>
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {participants.map(p => (
            <span key={p.participantId || p.id} className="px-3 py-1 bg-gray-800 rounded-full text-sm">
              {p.displayName} {p.teamName ? `(${p.teamName})` : ''}
            </span>
          ))}
        </div>
        
        <button onClick={() => setInControlPanel(true)}
          className="px-8 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-lg transition">
          🎮 Enter Host Control Panel
        </button>
        <p className="text-sm text-gray-400 mt-3">Access the control panel to start the quiz</p>
      </div>
    );
  }

  if (!started && inControlPanel) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        {/* HOST CONTROL PANEL BANNER */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg mb-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎮</span>
            <div>
              <div className="font-bold text-sm">HOST CONTROL PANEL</div>
              <div className="text-xs opacity-90">Ready to start the quiz</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setInControlPanel(false)}
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
            >
              ← Back to Lobby
            </button>
            <a 
              href="/admin"
              onClick={(e) => { e.preventDefault(); navigate('/admin'); }}
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
            >
              🏠 Dashboard
            </a>
            <a 
              href={`/display/${sessionId}?token=${adminToken}`}
              target="_blank"
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
            >
              📺 Open Display
            </a>
          </div>
        </div>
        <div className="flex justify-between items-center mb-4">
          <nav className="text-sm text-gray-400">
            <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
            <span className="mx-2">/</span>
            <a href={`/admin/${adminToken}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${adminToken}`); }} className="hover:text-white transition">Quiz</a>
            <span className="mx-2">/</span>
            <span className="text-white">Host Control</span>
          </nav>
        </div>
        {!connected && <div className="bg-red-900 text-red-200 text-center py-2 px-4 rounded-lg mb-4 text-sm">Reconnecting...</div>}
        
        {sessionName && (
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-accent text-center">{sessionName}</h2>
          </div>
        )}
        
        <div className="bg-gray-800 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Players ({participants.length})</h2>
          {participants.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No players yet - waiting for players to join</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {participants.map(p => (
                <span key={p.participantId || p.id} className="px-3 py-1 bg-gray-700 rounded-full text-sm">
                  {p.displayName} {p.teamName ? `(${p.teamName})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        
        <div className="bg-gray-800 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Join Information</h2>
          <div className="flex justify-center mb-4">
            <QRCodeSVG value={joinCodeDisplay ? `${joinUrl}?code=${joinCodeDisplay}` : joinUrl} size={200} bgColor="transparent" fgColor="white" />
          </div>
          {joinCodeDisplay && (
            <p className="text-3xl font-mono font-bold tracking-widest mb-2 text-center">{joinCodeDisplay}</p>
          )}
          <p className="text-gray-400 text-center">Join at <span className="text-white font-mono">{joinUrl}</span></p>
        </div>
        
        <button onClick={startQuiz} disabled={participants.length === 0}
          className="w-full px-8 py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-xl transition">
          ▶️ Start Quiz
        </button>
        <p className="text-sm text-gray-400 mt-3 text-center">{participants.length === 0 ? 'Waiting for players to join' : (answerTimeSeconds ? `Timed mode (${answerTimeSeconds}s per question)` : 'Manual mode — you control when to close each question')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* HOST VIEW BANNER */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg mb-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎮</span>
          <div>
            <div className="font-bold text-sm">HOST CONTROL PANEL</div>
            <div className="text-xs opacity-90">You control the quiz flow from here</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a 
            href="/admin"
            onClick={(e) => { e.preventDefault(); navigate('/admin'); }}
            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
          >
            🏠 Dashboard
          </a>
          <a 
            href={`/display/${sessionId}?token=${adminToken}`}
            target="_blank"
            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
          >
            📺 Open Display
          </a>
        </div>
      </div>
      <div className="flex justify-between items-center mb-4">
        <nav className="text-sm text-gray-400">
          <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
          <span className="mx-2">/</span>
          <a href={`/admin/${adminToken}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${adminToken}`); }} className="hover:text-white transition">Quiz</a>
          <span className="mx-2">/</span>
          <span className="text-white">Live</span>
        </nav>
      </div>
      {!connected && <div className="bg-red-900 text-red-200 text-center py-2 px-4 rounded-lg mb-4 text-sm">Reconnecting...</div>}
      <div className="flex justify-between items-center mb-2">
        <span className="text-gray-400">Question {questionIndex + 1} of {totalQuestions}</span>
        <div className="flex items-center gap-4">
          {timeRemaining !== null && (
            <div className="flex items-center gap-2">
              <span className={`text-xl font-bold ${
                timeRemaining > answerTimeSeconds * 0.5 ? 'text-green-400' : 
                timeRemaining > answerTimeSeconds * 0.2 ? 'text-yellow-400' : 
                'text-red-400'
              }`}>
                ⏱️ {Math.ceil(timeRemaining)}s
              </span>
            </div>
          )}
          <span className={`font-semibold ${answerCount.count > 0 && answerCount.count === answerCount.total ? 'text-green-400' : 'text-gray-400'}`}>
            {answerCount.count}/{answerCount.total || participants.length} answered
            {answerCount.count > 0 && answerCount.count === answerCount.total && ' — All in!'}
          </span>
        </div>
      </div>

      {/* Timer bar */}
      {timeRemaining !== null && (
        <div className="w-full h-2 bg-gray-700 rounded-full mb-2 overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ease-linear ${
              timeRemaining > answerTimeSeconds * 0.5 ? 'bg-green-500' : 
              timeRemaining > answerTimeSeconds * 0.2 ? 'bg-yellow-500' : 
              'bg-red-500'
            }`}
            style={{ width: `${(timeRemaining / answerTimeSeconds) * 100}%` }}
          />
        </div>
      )}

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-700 rounded-full mb-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${answerCount.count === answerCount.total && answerCount.total > 0 ? 'bg-green-500' : 'bg-accent'}`}
          style={{ width: `${answerCount.total ? (answerCount.count / answerCount.total) * 100 : 0}%` }}
        />
      </div>

      {/* Waiting for */}
      {answerCount.waiting.length > 0 && (
        <div className="mb-4 text-sm">
          <span className="text-gray-500">Waiting for: </span>
          <span className="text-gray-400">{answerCount.waiting.join(', ')}</span>
        </div>
      )}

      {currentQuestion && (
        <div className="bg-gray-800 rounded-xl p-6 mb-6">
          <h2 className="text-2xl font-bold">{currentQuestion.text}</h2>
          {currentQuestion.imageUrl && <img src={currentQuestion.imageUrl} alt="" className="mt-4 rounded-lg max-h-64 mx-auto" />}
        </div>
      )}

      <div className="mb-6">
        {currentPhase === 'get_ready' ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4 animate-pulse">🎯</div>
            <p className="text-2xl font-bold text-yellow-400">Get Ready!</p>
            <p className="text-gray-400 mt-2">Next question loading...</p>
          </div>
        ) : !currentPhase && !waitingForContinue && currentQuestion ? (
          <div>
            {!answerTimeSeconds && (
              <button onClick={closeQuestion} disabled={closing}
                className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition">
                {closing ? '⏳ Closing...' : '⏹️ Close Question'}
              </button>
            )}
            {!answerTimeSeconds && (
              <p className="text-sm text-gray-500 text-center mt-2">Manual mode — close when ready to reveal answers</p>
            )}
          </div>
        ) : waitingForContinue ? (
          <div>
            <div className="flex gap-4 mb-4">
              {/* Stats panel */}
              {questionStats && (
                <div className="flex-1 bg-gray-800 rounded-xl p-6">
                  <h3 className="text-lg font-bold mb-3 text-gray-300">Question Statistics</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Answered</span>
                      <span className="text-2xl font-bold">{questionStats.totalCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Correct</span>
                      <span className={`text-2xl font-bold ${questionStats.correctCount > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                        {questionStats.correctCount} ({questionStats.totalCount > 0 ? Math.round((questionStats.correctCount / questionStats.totalCount) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="border-t border-gray-700 pt-3 mt-3">
                      <p className="text-sm text-gray-400 mb-2">Correct Answer{questionStats.correctAnswers?.length > 1 ? 's' : ''}:</p>
                      {questionStats.question.type === 'numeric' && (
                        <div className="bg-green-500/20 border border-green-500 rounded-lg p-3 text-center">
                          <span className="text-2xl font-bold text-green-400">{questionStats.question.correctValue}</span>
                        </div>
                      )}
                      {questionStats.correctAnswers && questionStats.correctAnswers.length > 0 && (
                        <div className="space-y-2">
                          {questionStats.correctAnswers.map((answer, idx) => (
                            <div key={idx} className="bg-green-500/20 border border-green-500 rounded-lg p-3">
                              {answer.partLabel && <span className="text-xs text-green-400 font-semibold">{answer.partLabel}: </span>}
                              <span className="text-lg font-bold text-green-400">{answer.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* Round winner badge */}
              {roundWinner && (
                <div className="flex-1 bg-gradient-to-br from-yellow-900/30 to-yellow-800/20 rounded-xl p-6 border-2 border-yellow-500">
                  <div className="text-center">
                    <div className="text-4xl mb-3">⚡</div>
                    <h3 className="text-xl font-bold text-yellow-400 mb-4">Fastest Answer!</h3>
                    <div className="bg-gray-900/50 rounded-lg p-4 mb-3">
                      <p className="text-2xl font-bold text-white">{roundWinner.name}</p>
                      {roundWinner.team && <p className="text-lg text-gray-400 mt-1">{roundWinner.team}</p>}
                    </div>
                    <div className="flex justify-center gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-xs text-gray-400">Time</p>
                        <p className="text-xl font-bold text-yellow-400">{(roundWinner.timeMs / 1000).toFixed(2)}s</p>
                      </div>
                      <div className="text-xl text-gray-600">•</div>
                      <div className="text-center">
                        <p className="text-xs text-gray-400">Points</p>
                        <p className="text-xl font-bold text-green-400">+{roundWinner.points}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {nextQuestion && (
              <div className="bg-blue-900/30 border border-blue-500/50 rounded-xl p-4 mb-4">
                <p className="text-xs text-blue-400 font-semibold mb-1 uppercase tracking-wide">Up Next — Question {questionIndex + 2} of {totalQuestions}</p>
                <p className="text-lg font-bold text-white">{nextQuestion.text}</p>
                <span className="text-xs text-blue-300 mt-1 inline-block">{nextQuestion.type?.replace('_', ' ')}</span>
              </div>
            )}
            <button onClick={continueToNext} disabled={continuing} className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition">
              {continuing ? '⏳ Loading...' : (questionIndex + 1 >= totalQuestions ? '🏆 Show Final Results' : '▶️ Show Next Question')}
            </button>
          </div>
        ) : currentPhase && currentPhase !== 'get_ready' ? (
          <div>
            {/* Stats and Winner panels - side by side */}
            <div className="flex gap-4 mb-4">
              {questionStats && (
                <div className="flex-1 bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Responses:</p>
                      <p className="text-lg font-semibold">
                        {questionStats.totalCount !== undefined ? (
                          <span>{questionStats.totalCount} answered</span>
                        ) : (
                          <span>Results pending...</span>
                        )}
                      </p>
                    </div>
                    {questionStats.correctCount !== undefined && questionStats.totalCount > 0 && (
                      <div>
                        <p className="text-sm text-gray-400 mb-1">Correct:</p>
                        <p className="text-lg font-semibold text-green-400">
                          {questionStats.correctCount} ({Math.round((questionStats.correctCount / questionStats.totalCount) * 100)}%)
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-gray-400 mb-2">Correct Answer{questionStats.correctAnswers?.length > 1 ? 's' : ''}:</p>
                      {questionStats.question?.type === 'numeric' && questionStats.question.correctValue !== null && (
                        <div className="bg-green-500/20 border border-green-500 rounded-lg p-3 text-center">
                          <span className="text-2xl font-bold text-green-400">{questionStats.question.correctValue}</span>
                        </div>
                      )}
                      {questionStats.correctAnswers && questionStats.correctAnswers.length > 0 && (
                        <div className="space-y-2">
                          {questionStats.correctAnswers.map((answer, idx) => (
                            <div key={idx} className="bg-green-500/20 border border-green-500 rounded-lg p-3">
                              {answer.partLabel && <span className="text-xs text-green-400 font-semibold">{answer.partLabel}: </span>}
                              <span className="text-lg font-bold text-green-400">{answer.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* Round winner badge */}
              {roundWinner && (
                <div className="flex-1 bg-gradient-to-br from-yellow-900/30 to-yellow-800/20 rounded-lg p-6 border-2 border-yellow-500">
                  <div className="text-center">
                    <div className="text-4xl mb-3">⚡</div>
                    <h3 className="text-xl font-bold text-yellow-400 mb-4">Fastest Answer!</h3>
                    <div className="bg-gray-900/50 rounded-lg p-4 mb-3">
                      <p className="text-2xl font-bold text-white">{roundWinner.name}</p>
                      {roundWinner.team && <p className="text-lg text-gray-400 mt-1">{roundWinner.team}</p>}
                    </div>
                    <div className="flex justify-center gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-xs text-gray-400">Time</p>
                        <p className="text-xl font-bold text-yellow-400">{(roundWinner.timeMs / 1000).toFixed(2)}s</p>
                      </div>
                      <div className="text-xl text-gray-600">•</div>
                      <div className="text-center">
                        <p className="text-xs text-gray-400">Points</p>
                        <p className="text-xl font-bold text-green-400">+{roundWinner.points}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Manual advance button */}
            <button onClick={advancePhase} disabled={advancing} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition">
              {currentPhase === 'correct_answer' && '⏩ Skip to Round Winner'}
              {currentPhase === 'round_result' && '⏩ Skip to Scoreboard'}
              {currentPhase === 'scoreboard' && (questionIndex + 1 >= totalQuestions ? '🏆 Show Final Results' : '▶️ Show Next Question')}
            </button>
          </div>
        ) : null}
      </div>

      {!waitingForContinue && !currentPhase && <p className="text-center text-sm text-gray-400 mb-6">⏰ Results will show automatically when timer expires</p>}
      {waitingForContinue && <p className="text-center text-sm text-gray-400 mb-6">Ready to continue? Click to show the next question countdown</p>}
      {currentPhase === 'get_ready' && <p className="text-center text-sm text-gray-400 mb-6">🎯 Countdown on display - question will appear shortly</p>}

      {scores.length > 0 && <Scoreboard scores={scores} mini />}

      {showReview && currentQuestion && (
        <ReviewPanel
          sessionId={sessionId}
          adminToken={adminToken}
          questionId={currentQuestion.id}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}

function ReviewPanel({ sessionId, adminToken, questionId, onClose }) {
  const [responses, setResponses] = useState([]);

  const loadResponses = () => {
    fetch(`/api/session/${sessionId}/question/${questionId}/responses`, {
      headers: { 'X-Admin-Token': adminToken }
    }).then(r => r.json()).then(setResponses);
  };

  useEffect(() => { loadResponses(); }, [questionId]);

  const override = async (responseId, isCorrect) => {
    await fetch(`/api/session/${sessionId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ responseId, isCorrect })
    });
    loadResponses();
  };

  const formatAnswer = (textAnswer) => {
    try {
      const parsed = JSON.parse(textAnswer);
      if (typeof parsed === 'object') {
        return Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
      }
    } catch {}
    return textAnswer;
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Review Answers</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        {responses.length === 0 ? (
          <p className="text-gray-500">No answers yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {responses.map(r => (
              <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                r.isCorrect ? 'bg-green-900/30 border-green-800' : r.reviewed ? 'bg-red-900/30 border-red-800' : 'bg-gray-700 border-gray-600'
              }`}>
                <div className="flex-1">
                  <span className="text-sm text-gray-400">{r.displayName}</span>
                  <p className="font-medium">{r.answerText || formatAnswer(r.textAnswer) || <span className="text-gray-500 italic">No answer</span>}</p>
                  {r.pointsAwarded > 0 && <span className="text-xs text-green-400">+{r.pointsAwarded} pts</span>}
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => override(r.id, true)}
                    className={`px-3 py-1 rounded text-sm font-semibold ${r.isCorrect ? 'bg-green-600' : 'bg-gray-600 hover:bg-green-600'}`}
                  >✓</button>
                  <button
                    onClick={() => override(r.id, false)}
                    className={`px-3 py-1 rounded text-sm font-semibold ${!r.isCorrect && r.reviewed ? 'bg-red-600' : 'bg-gray-600 hover:bg-red-600'}`}
                  >✗</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
