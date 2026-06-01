import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../socket.js';
import Scoreboard from '../components/Scoreboard.jsx';

function MiniQR({ joinCode }) {
  if (!joinCode) return null;
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join` : '';
  const qrUrl = `${joinUrl}?code=${joinCode}`;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-xl p-2 border border-white/10">
      <QRCodeSVG value={qrUrl} size={64} bgColor="transparent" fgColor="white" />
      <div className="flex flex-col pr-2">
        <span className="text-[10px] text-white/50 leading-tight">Join at</span>
        <span className="text-xs font-mono font-bold text-white/80 leading-tight">{window.location.host}/join</span>
        <span className="text-lg font-bold text-accent leading-tight">{joinCode}</span>
      </div>
    </div>
  );
}

// Display mode for showing on a screen/projector during quiz
export default function DisplayView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const adminToken = searchParams.get('token');

  const [phase, setPhase] = useState('waiting');
  const [question, setQuestion] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [scores, setScores] = useState([]);
  const [joinCode, setJoinCode] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [answerTimeSeconds, setAnswerTimeSeconds] = useState(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(null);
  const [answerCount, setAnswerCount] = useState({ count: 0, total: 0 });
  const [winner, setWinner] = useState(null);
  const [roundWinner, setRoundWinner] = useState(null);
  const [questionWinner, setQuestionWinner] = useState(null);
  const [getReadyCountdown, setGetReadyCountdown] = useState(null);
  const [sessionName, setSessionName] = useState('');
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const [correctAnswerQuestion, setCorrectAnswerQuestion] = useState(null);
  const [answers, setAnswers] = useState([]);

  useEffect(() => {
    // Load initial state
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      setJoinCode(data.joinCode || '');
      setScores(data.scores || []);
      if (data.sessionName) setSessionName(data.sessionName);
      
      // Set timer settings from quiz configuration
      if (data.answerTimeSeconds !== undefined) {
        setAnswerTimeSeconds(data.answerTimeSeconds);
      }
      
      if (data.status === 'waiting') {
        setPhase('waiting');
      } else if (data.status === 'active') {
        if (data.question) {
          setQuestion(data.question);
          setQuestionIndex(data.questionIndex);
          setTotalQuestions(data.totalQuestions);
          setAnswers(data.answers || []);
          
          if (data.questionStartedAt) {
            setQuestionStartedAt(data.questionStartedAt);
          }
        }

        // Restore phase-specific data
        if (data.roundWinner) setRoundWinner(data.roundWinner);
        if (data.correctAnswers) {
          setCorrectAnswers(data.correctAnswers);
          setCorrectAnswerQuestion(data.question);
        }

        // Restore phase from server
        if (data.currentPhase) {
          const phaseMap = {
            round_result: 'roundResult',
            correct_answer: 'correctAnswer',
            waiting_for_continue: 'scoreboard',
            get_ready: 'getReady',
          };
          setPhase(phaseMap[data.currentPhase] || data.currentPhase);
        } else if (data.question) {
          setPhase('question');
        }
      } else if (data.status === 'finished') {
        setPhase('finished');
        if (data.scores && data.scores.length > 0) {
          setWinner(data.scores[0]);
        }
      }
    });

    // Socket
    socket.connect();
    socket.emit('host:session', { sessionId, adminToken });

    socket.on('session:started', (data) => {
      setPhase('question');
      setQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setAnswers(data.answers || []);
      
      if (data.questionStartedAt) {
        setQuestionStartedAt(data.questionStartedAt);
      }
      if (data.answerTimeSeconds !== undefined) {
        setAnswerTimeSeconds(data.answerTimeSeconds);
      }
    });

    socket.on('session:question', (data) => {
      setPhase('question');
      setQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setAnswerCount({ count: 0, total: 0 });
      setRoundWinner(null);
      setAnswers(data.answers || []); // Clear previous round winner
      
      if (data.questionStartedAt) {
        setQuestionStartedAt(data.questionStartedAt);
      }
      if (data.answerTimeSeconds !== undefined) {
        setAnswerTimeSeconds(data.answerTimeSeconds);
      }
    });

    socket.on('session:round_result', (data) => {
      setRoundWinner(data.winner);
      setPhase('roundResult');
    });

    socket.on('session:correct_answer', (data) => {
      setCorrectAnswerQuestion(data.question);
      setCorrectAnswers(data.correctAnswers || []);
      setPhase('correctAnswer');
    });

    socket.on('session:scores', (data) => {
      setScores(data.scores || []);
      setQuestionWinner(data.roundWinner || null);
      setPhase('scoreboard');
    });

    socket.on('session:finished', (data) => {
      setPhase('finished');
      setScores(data.results || []);
      if (data.results && data.results.length > 0) {
        setWinner(data.results[0]);
      }
    });

    socket.on('session:reset', () => {
      setPhase('waiting');
      setScores([]);
      setQuestion(null);
      setQuestionIndex(0);
      setAnswerCount({ count: 0, total: 0 });
    });

    socket.on('session:answer_count', (data) => {
      setAnswerCount({ count: data.count, total: data.total });
    });

    socket.on('session:get_ready', (data) => {
      setPhase('getReady');
      setGetReadyCountdown(data.countdown || 3);
    });

    socket.on('session:state', (data) => {
      setScores(data.scores || []);
      
      // Restore phase from server state
      if (data.currentPhase) {
        setPhase(data.currentPhase === 'round_result' ? 'roundResult' : 
                 data.currentPhase === 'correct_answer' ? 'correctAnswer' : 
                 data.currentPhase);
      }
      
      if (data.status === 'active') {
        if (data.question) {
          setQuestion(data.question);
        }
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
      } else if (data.status === 'finished') {
        setPhase('finished');
        if (data.scores && data.scores.length > 0) {
          setWinner(data.scores[0]);
        }
      }
    });

    socket.on('connect', () => {
      socket.emit('host:session', { sessionId, adminToken });
    });

    return () => {
      socket.off('session:started');
      socket.off('session:question');
      socket.off('session:correct_answer');
      socket.off('session:round_result');
      socket.off('session:scores');
      socket.off('session:finished');
      socket.off('session:reset');
      socket.off('session:answer_count');
      socket.off('session:get_ready');
      socket.off('session:state');
      socket.off('connect');
    };
  }, [sessionId, adminToken]);

  // Timer effect for question phase
  useEffect(() => {
    if (phase === 'question' && questionStartedAt && answerTimeSeconds) {
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
  }, [phase, questionStartedAt, answerTimeSeconds]);

  // Timer effect for Get Ready countdown
  useEffect(() => {
    if (phase === 'getReady' && getReadyCountdown !== null && getReadyCountdown > 0) {
      const timeout = setTimeout(() => {
        setGetReadyCountdown(prev => Math.max(0, prev - 1));
      }, 1000);
      
      return () => clearTimeout(timeout);
    }
  }, [phase, getReadyCountdown]);

  const timerPercentage = timeRemaining !== null && answerTimeSeconds > 0 
    ? (timeRemaining / answerTimeSeconds) * 100 
    : 100;
  
  const timerColor = timerPercentage > 50 ? 'bg-green-500' : timerPercentage > 20 ? 'bg-yellow-500' : 'bg-red-500';

  // Waiting phase
  if (phase === 'waiting') {
    const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join` : '';
    const qrUrl = joinCode ? `${joinUrl}?code=${joinCode}` : joinUrl;
    
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <a 
          href={`/host/${sessionId}?token=${adminToken}`}
          className="absolute top-4 right-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition border border-gray-700"
        >
          🎮 Host Controls
        </a>
        
        {sessionName && (
          <div className="mb-8">
            <h2 className="text-6xl font-bold text-accent text-center animate-pulse">{sessionName}</h2>
          </div>
        )}
        
        <h1 className="text-6xl font-bold mb-8 text-center">Ready to Start!</h1>
        
        {/* QR Code */}
        {joinCode && (
          <div className="mb-6">
            <QRCodeSVG 
              value={qrUrl} 
              size={280} 
              bgColor="transparent" 
              fgColor="currentColor"
              className="text-white"
            />
          </div>
        )}
        
        {/* Join Code */}
        <div className="text-9xl font-bold mb-4 tracking-wider text-accent">{joinCode}</div>
        
        {/* Join URL */}
        <p className="text-4xl font-mono font-semibold mb-4 text-white">{window.location.host}/join</p>
        
        <p className="text-2xl text-text-secondary">Scan QR code or enter code to join</p>
      </div>
    );
  }

  // Question phase
  if (phase === 'question' && question) {
    return (
      <div className="flex flex-col min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <MiniQR joinCode={joinCode} />
        <a 
          href={`/host/${sessionId}?token=${adminToken}`}
          className="absolute top-4 right-4 px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700 rounded-lg text-xs font-semibold transition border border-gray-700 opacity-50 hover:opacity-100"
        >
          🎮 Host
        </a>
        {/* Top Bar with Timer */}
        <div className="flex justify-between items-center mb-6">
          <span className="text-2xl text-text-secondary">Question {questionIndex + 1} of {totalQuestions}</span>
          
          {/* Large Countdown Timer */}
          <div className="flex items-center gap-4">
            <span className="text-xl text-text-secondary">{answerCount.count}/{answerCount.total} answered</span>
            {timeRemaining !== null && (
              <div className="relative flex items-center justify-center">
                <div className={`w-24 h-24 rounded-full border-8 flex items-center justify-center ${
                  timerPercentage > 50 ? 'border-green-500 bg-green-500/10' : 
                  timerPercentage > 20 ? 'border-yellow-500 bg-yellow-500/10' : 
                  'border-red-500 bg-red-500/10 animate-pulse'
                }`}>
                  <span className={`text-4xl font-bold ${
                    timerPercentage > 50 ? 'text-green-400' : 
                    timerPercentage > 20 ? 'text-yellow-400' : 
                    'text-red-400'
                  }`}>
                    {Math.ceil(timeRemaining)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Timer Bar */}
        {timeRemaining !== null && (
          <div className="mb-6">
            <div className="w-full h-3 bg-bg-card rounded-full overflow-hidden">
              <div 
                className={`h-full ${timerColor} transition-all duration-300 ease-linear`}
                style={{ width: `${timerPercentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Question */}
        <div className="flex-1 flex flex-col justify-center">
          <h2 className="text-5xl font-bold text-center mb-6">{question.text}</h2>
          {question.imageUrl && (
            <img src={question.imageUrl} alt="" className="max-h-96 mx-auto rounded-lg shadow-2xl mb-6" />
          )}
          {answers.length > 0 && (question.type === 'single_choice' || question.type === 'multiple_choice' || question.type === 'true_false') && (
            <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto w-full mt-4">
              {answers.map((a, idx) => {
                const colors = ['bg-red-600/30 border-red-500', 'bg-blue-600/30 border-blue-500', 'bg-yellow-600/30 border-yellow-500', 'bg-green-600/30 border-green-500', 'bg-purple-600/30 border-purple-500', 'bg-pink-600/30 border-pink-500'];
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return (
                  <div key={a.id} className={`${colors[idx % colors.length]} border-2 rounded-xl p-5 flex items-center gap-4`}>
                    <span className="text-2xl font-bold text-white/60 w-10">{letters[idx]}</span>
                    <span className="text-2xl font-semibold text-white">{a.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Correct Answer Reveal Phase
  if (phase === 'correctAnswer' && correctAnswerQuestion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <MiniQR joinCode={joinCode} />
        <div className="text-8xl mb-6 animate-pulse">✅</div>
        <h1 className="text-6xl font-bold mb-8 text-center text-green-400">Correct Answer!</h1>
        
        <div className="bg-bg-card/50 backdrop-blur-sm border-2 border-green-500 rounded-2xl p-12 shadow-2xl max-w-4xl w-full">
          <h2 className="text-4xl font-bold mb-8 text-center text-text-secondary">{correctAnswerQuestion.text}</h2>
          
          {correctAnswerQuestion.type === 'numeric' && (
            <div className="text-center">
              <p className="text-6xl font-bold text-green-400">{correctAnswerQuestion.correctValue}</p>
            </div>
          )}
          
          {(correctAnswerQuestion.type === 'single_choice' || correctAnswerQuestion.type === 'true_false' || correctAnswerQuestion.type === 'multiple_choice' || correctAnswerQuestion.type === 'free_text') && (
            <div className="space-y-4">
              {correctAnswers.map((answer, idx) => (
                <div key={answer.id || idx} className="bg-green-500/20 border-2 border-green-500 rounded-xl p-6 text-center">
                  <p className="text-4xl font-bold text-green-400">{answer.text}</p>
                </div>
              ))}
            </div>
          )}
          
          {correctAnswerQuestion.type === 'multi_part' && (
            <div className="space-y-4">
              {correctAnswers.reduce((acc, answer) => {
                const label = answer.partLabel || 'Answer';
                if (!acc[label]) acc[label] = [];
                acc[label].push(answer.text);
                return acc;
              }, {}) && Object.entries(correctAnswers.reduce((acc, answer) => {
                const label = answer.partLabel || 'Answer';
                if (!acc[label]) acc[label] = [];
                acc[label].push(answer.text);
                return acc;
              }, {})).map(([label, texts]) => (
                <div key={label} className="bg-green-500/20 border-2 border-green-500 rounded-xl p-6">
                  <p className="text-2xl font-semibold text-green-400 mb-2">{label}:</p>
                  <p className="text-3xl font-bold text-white">{texts.join(' or ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Round Result Phase - Show fastest player
  if (phase === 'roundResult' && roundWinner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <MiniQR joinCode={joinCode} />
        <div className="text-8xl mb-6 animate-bounce">⚡</div>
        <h1 className="text-6xl font-bold mb-4 text-center animate-pulse text-accent">Fastest Answer!</h1>
        <div className="bg-bg-card/50 backdrop-blur-sm border-2 border-accent rounded-2xl p-12 mt-8 shadow-2xl">
          <h2 className="text-5xl font-bold mb-4 text-center">{roundWinner.name}</h2>
          {roundWinner.team && (
            <p className="text-3xl text-text-secondary text-center mb-6">{roundWinner.team}</p>
          )}
          <div className="flex items-center justify-center gap-6 mt-6">
            <div className="text-center">
              <p className="text-2xl text-text-secondary">Time</p>
              <p className="text-5xl font-bold text-accent">{(roundWinner.timeMs / 1000).toFixed(2)}s</p>
            </div>
            <div className="text-6xl text-text-secondary">•</div>
            <div className="text-center">
              <p className="text-2xl text-text-secondary">Points</p>
              <p className="text-5xl font-bold text-green-400">+{roundWinner.points}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Scoreboard phase
  if (phase === 'scoreboard') {
    return (
      <div className="flex flex-col min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg justify-center">
        <MiniQR joinCode={joinCode} />
        {/* Question Winner - Top Scorer */}
        {questionWinner && (
          <div className="mb-6 text-center">
            <div className="inline-block bg-accent/20 border-2 border-accent rounded-xl px-8 py-4">
              <p className="text-xl text-text-secondary mb-1">🏆 Question Champion</p>
              <h3 className="text-3xl font-bold text-accent">{questionWinner.name}</h3>
              {questionWinner.team && (
                <p className="text-lg text-text-secondary">{questionWinner.team}</p>
              )}
              <p className="text-2xl font-bold text-green-400 mt-2">+{questionWinner.points} points</p>
            </div>
          </div>
        )}

        <h2 className="text-5xl font-bold text-center mb-8 animate-pulse">Scoreboard</h2>
        
        <div className="max-w-4xl mx-auto w-full">
          <Scoreboard scores={scores} maxVisible={10} displayMode={true} />
        </div>
      </div>
    );
  }

  // Get Ready phase - Countdown before next question
  if (phase === 'getReady') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <MiniQR joinCode={joinCode} />
        <h1 className="text-7xl font-bold mb-12 text-center animate-pulse">Get Ready!</h1>
        {getReadyCountdown !== null && getReadyCountdown > 0 && (
          <div className="relative">
            <div className="w-48 h-48 rounded-full border-8 border-accent bg-accent/10 flex items-center justify-center animate-pulse">
              <span className="text-9xl font-bold text-accent">{getReadyCountdown}</span>
            </div>
          </div>
        )}
        {getReadyCountdown === 0 && (
          <div className="text-6xl font-bold text-green-400 animate-bounce">GO!</div>
        )}
      </div>
    );
  }

  // Finished phase - Winner announcement
  if (phase === 'finished') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-bg via-bg-secondary to-bg">
        <MiniQR joinCode={joinCode} />
        <div className="text-8xl mb-6 animate-bounce">🏆</div>
        <h1 className="text-6xl font-bold mb-4 text-center animate-pulse">Quiz Complete!</h1>
        {winner && (
          <>
            <h2 className="text-4xl font-bold mb-2 text-accent animate-pulse">Winner: {winner.name}</h2>
            <p className="text-3xl text-text-secondary mb-8">Score: {winner.score.toLocaleString()}</p>
          </>
        )}
        <div className="max-w-4xl w-full mt-8">
          <h3 className="text-3xl font-bold mb-4 text-center">Final Standings</h3>
          <Scoreboard scores={scores} maxVisible={10} displayMode={true} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-2xl">Loading...</div>
    </div>
  );
}
