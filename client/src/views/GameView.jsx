import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSessionSocket, { socket } from '../hooks/useSessionSocket.js';
import { useCountdown, useGetReadyCountdown } from '../hooks/useCountdown.js';
import { viewPhase } from '../lib/phase.js';
import { applyTheme } from '../theme.js';
import Scoreboard from '../components/Scoreboard.jsx';

const POLL_INTERVAL = 8000;
const CANDY = ['🍬', '🍭', '🍫', '🧁', '🍪', '🎉', '🍩', '🍰', '⭐', '🌟'];

function CandyFireworks() {
  const [particles, setParticles] = useState([]);
  useEffect(() => {
    const items = [];
    for (let i = 0; i < 40; i++) {
      items.push({ id: i, emoji: CANDY[Math.floor(Math.random() * CANDY.length)], left: Math.random() * 100,
        delay: Math.random() * 1.5, duration: 2 + Math.random() * 2, size: 1.5 + Math.random() * 1.5, drift: -30 + Math.random() * 60 });
    }
    setParticles(items);
  }, []);
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map(p => (
        <div key={p.id} className="absolute animate-candy-fall"
          style={{ left: `${p.left}%`, fontSize: `${p.size}rem`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, '--drift': `${p.drift}px` }}>
          {p.emoji}
        </div>
      ))}
      <style>{`@keyframes candy-fall { 0% { top: -10%; opacity: 1; transform: translateX(0) rotate(0deg); } 100% { top: 110%; opacity: 0; transform: translateX(var(--drift)) rotate(720deg); } } .animate-candy-fall { animation: candy-fall var(--duration, 3s) ease-in forwards; }`}</style>
    </div>
  );
}

export default function GameView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const participantId = localStorage.getItem(`participant:${sessionId}`);
  const participantSecret = localStorage.getItem(`participantSecret:${sessionId}`);
  const [phase, setPhase] = useState('waiting');
  const [question, setQuestion] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [multiPartAnswers, setMultiPartAnswers] = useState({});
  const [error, setError] = useState('');
  const [liveCount, setLiveCount] = useState({ count: 0, total: 0 });
  const [scores, setScores] = useState([]);
  const [answerTimeSeconds, setAnswerTimeSeconds] = useState(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(null);
  const [getReadyStartedAt, setGetReadyStartedAt] = useState(null);
  const [roundWinner, setRoundWinner] = useState(null);
  const [questionWinner, setQuestionWinner] = useState(null);
  const questionIdRef = useRef(null);

  const timeRemaining = useCountdown(questionStartedAt, answerTimeSeconds, phase === 'question');
  const getReadyCountdown = useGetReadyCountdown(getReadyStartedAt, 5, phase === 'getReady');

  // A question arrived (socket event or state). Only a *new* question clears
  // the player's in-progress answer.
  const showQuestion = useCallback((data) => {
    const fresh = data.question?.id !== questionIdRef.current;
    questionIdRef.current = data.question?.id || null;
    setQuestion(data.question); setAnswers(data.answers || []);
    setQuestionIndex(data.questionIndex); setTotalQuestions(data.totalQuestions);
    if (fresh) { setSubmitted(false); setSelectedAnswer(null); setTextAnswer(''); setMultiPartAnswers({}); setError(''); }
    setLiveCount(data.answerCount ? { count: data.answerCount.count, total: data.answerCount.total } : { count: 0, total: 0 });
    setQuestionStartedAt(data.questionStartedAt || null);
    if (data.answerTimeSeconds !== undefined) setAnswerTimeSeconds(data.answerTimeSeconds);
    setRoundWinner(null);
    setPhase('question');
  }, []);

  // Full state from /current or session:state — the single hydration path.
  const applyState = useCallback((data) => {
    if (!data || data.error) return;
    if (data.themeColor) applyTheme(data.themeColor, data.lightMode);
    if (data.status === 'finished') { navigate(`/results/${sessionId}`); return; }
    if (data.status === 'waiting') { navigate(`/lobby/${sessionId}`); return; }
    setTotalQuestions(data.totalQuestions); setScores(data.scores || []);
    if (data.answerTimeSeconds !== undefined) setAnswerTimeSeconds(data.answerTimeSeconds);
    const view = viewPhase(data);
    if (view === 'getReady') {
      setGetReadyStartedAt(data.getReadyStartedAt || Math.floor(Date.now() / 1000));
      setQuestionIndex(data.questionIndex); setPhase('getReady'); return;
    }
    if (view === 'question') { showQuestion(data); return; }
    setQuestion(data.question); setQuestionIndex(data.questionIndex);
    setRoundWinner(data.roundWinner || null); setQuestionWinner(data.roundWinner || null);
    setPhase(view);
  }, [navigate, sessionId, showQuestion]);

  useEffect(() => { if (!participantId || !participantSecret) navigate('/join'); }, [participantId, participantSecret, navigate]);

  useSessionSocket({
    enabled: !!(participantId && participantSecret),
    deps: [sessionId],
    join: () => socket.emit('join:session', { sessionId, participantId, participantSecret }),
    handlers: {
      'session:state': applyState,
      'session:get_ready': (d) => { setGetReadyStartedAt(d.getReadyStartedAt); setQuestionIndex(d.nextQuestionIndex); setTotalQuestions(d.totalQuestions); setPhase('getReady'); },
      'session:question': showQuestion,
      'session:answer_count': (d) => setLiveCount({ count: d.count, total: d.total }),
      'session:correct_answer': () => setPhase('correctAnswer'),
      'session:round_result': (d) => { setRoundWinner(d.winner); setPhase('roundResult'); },
      'session:scores': (d) => { setScores(d.scores || []); setQuestionWinner(d.roundWinner || null); setPhase('scoreboard'); },
      'session:waiting_for_continue': () => setPhase('scoreboard'),
      'session:finished': () => navigate(`/results/${sessionId}`),
      'session:reset': () => {
        localStorage.removeItem(`participant:${sessionId}`);
        localStorage.removeItem(`participantSecret:${sessionId}`);
        navigate('/join');
      }
    }
  });

  // Fallback poll in case a socket event was missed
  useEffect(() => {
    const load = () => fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(applyState).catch(() => {});
    load();
    const timer = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [sessionId, applyState]);

  const submitAnswer = async () => {
    const body = { participantId, participantSecret, questionId: question.id };
    if (question.type === 'single_choice' || question.type === 'true_false') {
      if (!selectedAnswer) return;
      body.answerId = selectedAnswer;
    } else if (question.type === 'multiple_choice') {
      if (!selectedAnswer || selectedAnswer.length === 0) return;
      body.answerId = selectedAnswer;
    } else if (question.type === 'multi_part') {
      if (!Object.values(multiPartAnswers).some(v => v.trim())) return;
      body.textAnswer = JSON.stringify(multiPartAnswers);
    } else {
      if (!textAnswer.trim()) return;
      body.textAnswer = textAnswer.trim();
    }
    try {
      const res = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) setSubmitted(true);
      else { const err = await res.json(); setError(err.error || 'Failed to submit'); }
    } catch { setError('Connection error. Tap to retry.'); }
  };

  const timerPercentage = timeRemaining !== null && answerTimeSeconds > 0 ? (timeRemaining / answerTimeSeconds) * 100 : 100;
  const timerColor = timerPercentage > 50 ? 'bg-green-500' : timerPercentage > 20 ? 'bg-yellow-500' : 'bg-red-500';
  const answerLetters = ['A', 'B', 'C', 'D', 'E', 'F'];

  if (phase === 'getReady') return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-5xl font-bold mb-8 text-center animate-pulse">Get Ready!</h1>
      {getReadyCountdown !== null && getReadyCountdown > 0 && (
        <div className="w-32 h-32 rounded-full border-8 border-accent bg-accent/10 flex items-center justify-center animate-pulse">
          <span className="text-7xl font-bold text-accent">{getReadyCountdown}</span>
        </div>
      )}
    </div>
  );

  if (phase === 'roundResult' && roundWinner) {
    const isMe = roundWinner.participantId === participantId;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden">
        {isMe && <CandyFireworks />}
        <div className="text-6xl mb-4 animate-bounce">{isMe ? '🍬' : '⚡'}</div>
        <h1 className={`text-4xl font-bold mb-3 text-center animate-pulse ${isMe ? 'text-yellow-400' : 'text-accent'}`}>{isMe ? 'You were the fastest! 🎉' : 'Fastest Answer!'}</h1>
        <div className="bg-bg-card border-2 border-accent rounded-xl p-6 mt-4 shadow-xl">
          <h2 className="text-3xl font-bold mb-2 text-center">{roundWinner.name}</h2>
          {roundWinner.team && <p className="text-xl text-text-secondary text-center mb-4">{roundWinner.team}</p>}
          <div className="flex items-center justify-center gap-4 mt-4">
            <div className="text-center"><p className="text-sm text-text-secondary">Time</p><p className="text-2xl font-bold text-accent">{(roundWinner.timeMs / 1000).toFixed(2)}s</p></div>
            <div className="text-4xl text-text-secondary">•</div>
            <div className="text-center"><p className="text-sm text-text-secondary">Points</p><p className="text-2xl font-bold text-green-400">+{roundWinner.points}</p></div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'scoreboard') return (
    <div className="flex flex-col min-h-screen p-4 justify-center">
      {questionWinner && (
        <div className="mb-4 text-center">
          <div className="inline-block bg-accent/20 border-2 border-accent rounded-lg px-6 py-3">
            <p className="text-sm text-text-secondary mb-1">🏆 Question Champion</p>
            <h3 className="text-2xl font-bold text-accent">{questionWinner.name}</h3>
            <p className="text-xl font-bold text-green-400 mt-1">+{questionWinner.points} points</p>
          </div>
        </div>
      )}
      <h2 className="text-2xl font-bold text-center mb-6">Scoreboard</h2>
      <Scoreboard scores={scores} maxVisible={10} />
      <p className="text-center text-text-secondary mt-6 text-sm">
        {questionIndex + 1 >= totalQuestions ? 'Final results coming up...' : 'Next question coming up...'}
      </p>
    </div>
  );

  if (!question || phase === 'waiting') return (
    <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-xl">Waiting for question...</div></div>
  );

  const isChoiceType = ['single_choice', 'true_false', 'multiple_choice'].includes(question.type);
  const isTextType = ['free_text', 'numeric', 'estimation'].includes(question.type);
  const isMultiPart = question.type === 'multi_part';
  const partLabels = isMultiPart ? [...new Set(answers.map(a => a.partLabel).filter(Boolean))] : [];

  return (
    <div className="flex flex-col min-h-screen p-4">
      <div className="text-center mb-2"><span className="text-text-secondary text-sm">Question {questionIndex + 1} of {totalQuestions}</span></div>
      {timeRemaining !== null && (
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-text-secondary">Time remaining</span>
            <span className={`text-sm font-bold ${timerPercentage <= 10 ? 'text-red-500 animate-pulse' : ''}`}>{Math.ceil(timeRemaining)}s</span>
          </div>
          <div className="w-full h-2 bg-bg-card rounded-full overflow-hidden">
            <div className={`h-full ${timerColor} transition-all duration-300 ease-linear`} style={{ width: `${timerPercentage}%` }} />
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col justify-center">
        <h2 className="text-xl font-bold text-center mb-2">{question.text}</h2>
        {question.imageUrl && <img src={question.imageUrl} alt="" className="max-h-48 mx-auto rounded-lg mb-4" />}
        {submitted ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">✓</div>
            <p className="text-lg text-text-secondary mb-2">Answer received!</p>
            {liveCount.total > 0 && <p className="text-sm text-text-secondary mb-4">{liveCount.count}/{liveCount.total} answered</p>}
            <button onClick={() => setSubmitted(false)} className="px-6 py-2 border border-border-theme rounded-lg text-text-secondary hover:bg-bg-card transition text-sm">Change answer</button>
          </div>
        ) : (
          <>
            {isChoiceType && (
              <div className="grid grid-cols-1 gap-3 mt-4">
                {answers.map((a, i) => {
                  const isSelected = question.type === 'multiple_choice' ? (selectedAnswer || []).includes(a.id) : selectedAnswer === a.id;
                  return (
                    <button key={a.id}
                      onClick={() => {
                        if (question.type === 'multiple_choice') setSelectedAnswer(prev => { const arr = prev || []; return arr.includes(a.id) ? arr.filter(id => id !== a.id) : [...arr, a.id]; });
                        else setSelectedAnswer(a.id);
                      }}
                      className={`btn-answer py-4 px-6 text-lg font-semibold text-left ${isSelected ? 'selected' : ''}`}>
                      <span className="font-bold mr-3 opacity-60">{answerLetters[i % answerLetters.length]}</span> {a.text}
                    </button>
                  );
                })}
              </div>
            )}
            {isTextType && (
              <div className="mt-4">
                <input type={question.type === 'free_text' ? 'text' : 'number'} step="any"
                  placeholder={question.type === 'free_text' ? 'Type your answer...' : 'Enter a number...'}
                  value={textAnswer} onChange={e => setTextAnswer(e.target.value)} maxLength={100}
                  className="w-full px-4 py-3 text-lg bg-bg-card border border-border-theme rounded-lg focus:outline-none focus:border-accent" autoFocus />
              </div>
            )}
            {isMultiPart && (
              <div className="mt-4 flex flex-col gap-3">
                {partLabels.map(label => (
                  <div key={label}>
                    <label className="text-sm text-text-secondary mb-1 block">{label}</label>
                    <input type="text" placeholder={`Enter ${label.toLowerCase()}...`}
                      value={multiPartAnswers[label] || ''}
                      onChange={e => setMultiPartAnswers(prev => ({ ...prev, [label]: e.target.value }))}
                      maxLength={100} className="w-full px-4 py-3 text-lg bg-bg-card border border-border-theme rounded-lg focus:outline-none focus:border-accent" />
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-red-400 text-sm text-center mt-2 cursor-pointer" onClick={() => setError('')}>{error}</p>}
            <button onClick={submitAnswer}
              disabled={phase !== 'question' || (timeRemaining !== null && timeRemaining <= 0) || (isChoiceType ? !selectedAnswer : isMultiPart ? !Object.values(multiPartAnswers).some(v => v.trim()) : !textAnswer.trim())}
              className="w-full mt-4 py-4 bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-lg transition">
              {phase !== 'question' ? 'Question closed' : timeRemaining !== null && timeRemaining <= 0 ? "Time's Up!" : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
