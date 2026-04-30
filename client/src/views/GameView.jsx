import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket.js';

const POLL_INTERVAL = 8000;

export default function GameView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('participantId');

  const [question, setQuestion] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [multiPartAnswers, setMultiPartAnswers] = useState({});
  const [error, setError] = useState('');

  const questionIndexRef = useRef(0);
  const pollTimer = useRef(null);

  const applyState = useCallback((data) => {
    if (data.status === 'finished') {
      navigate(`/results/${sessionId}`);
      return;
    }
    if (data.status === 'waiting') {
      navigate(`/lobby/${sessionId}`);
      return;
    }
    if (data.questionIndex !== undefined && data.questionIndex > questionIndexRef.current) {
      setQuestion(data.question);
      setAnswers(data.answers || []);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setSubmitted(false);
      setSelectedAnswer(null);
      setTextAnswer('');
      setMultiPartAnswers({});
      setError('');
      questionIndexRef.current = data.questionIndex;
    } else if (data.question && questionIndexRef.current === 0 && !question) {
      // First question
      setQuestion(data.question);
      setAnswers(data.answers || []);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      questionIndexRef.current = data.questionIndex;
    }
  }, [navigate, sessionId, question]);

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

    socket.on('session:question', (data) => {
      setQuestion(data.question);
      setAnswers(data.answers || []);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setSubmitted(false);
      setSelectedAnswer(null);
      setTextAnswer('');
      setMultiPartAnswers({});
      setError('');
      questionIndexRef.current = data.questionIndex;
    });

    socket.on('session:started', (data) => {
      setQuestion(data.question);
      setAnswers(data.answers || []);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      questionIndexRef.current = data.questionIndex;
    });

    socket.on('session:state', applyState);

    socket.on('session:finished', () => {
      navigate(`/results/${sessionId}`);
    });

    // Initial state
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(applyState);

    // Polling fallback
    pollTimer.current = setInterval(() => {
      fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(applyState).catch(() => {});
    }, POLL_INTERVAL);

    return () => {
      socket.off('session:question');
      socket.off('session:started');
      socket.off('session:state');
      socket.off('session:finished');
      clearInterval(pollTimer.current);
    };
  }, [sessionId, participantId, navigate, applyState]);

  const submitAnswer = async () => {
    if (submitted) return;

    const body = { participantId, questionId: question.id };

    if (question.type === 'single_choice' || question.type === 'true_false') {
      if (!selectedAnswer) return;
      body.answerId = selectedAnswer;
    } else if (question.type === 'multiple_choice') {
      if (!selectedAnswer || selectedAnswer.length === 0) return;
      body.answerId = selectedAnswer; // array
    } else if (question.type === 'multi_part') {
      const hasAnyAnswer = Object.values(multiPartAnswers).some(v => v.trim());
      if (!hasAnyAnswer) return;
      body.textAnswer = JSON.stringify(multiPartAnswers);
    } else {
      if (!textAnswer.trim()) return;
      body.textAnswer = textAnswer.trim();
    }

    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const err = await res.json();
        if (res.status === 409) {
          setSubmitted(true); // already answered
        } else {
          setError(err.error || 'Failed to submit');
        }
      }
    } catch {
      setError('Connection error. Tap to retry.');
    }
  };

  const answerColors = ['bg-red-600', 'bg-blue-600', 'bg-yellow-600', 'bg-green-600', 'bg-purple-600', 'bg-pink-600'];

  if (!question) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-xl">Waiting for question...</div>
      </div>
    );
  }

  const isChoiceType = ['single_choice', 'true_false', 'multiple_choice'].includes(question.type);
  const isTextType = ['free_text', 'numeric', 'estimation'].includes(question.type);
  const isMultiPart = question.type === 'multi_part';

  // Extract part labels from answers (answers carry part_label info via the question's answers)
  const partLabels = isMultiPart ? [...new Set(answers.map(a => a.partLabel).filter(Boolean))] : [];

  return (
    <div className="flex flex-col min-h-screen p-4">
      <div className="text-center mb-4">
        <span className="text-gray-400 text-sm">Question {questionIndex + 1} of {totalQuestions}</span>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <h2 className="text-xl font-bold text-center mb-2">{question.text}</h2>
        {question.imageUrl && <img src={question.imageUrl} alt="" className="max-h-48 mx-auto rounded-lg mb-4" />}

        {submitted ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">✓</div>
            <p className="text-lg text-gray-400">Answer received!</p>
          </div>
        ) : (
          <>
            {isChoiceType && (
              <div className="grid grid-cols-1 gap-3 mt-4">
                {answers.map((a, i) => {
                  const isSelected = question.type === 'multiple_choice'
                    ? (selectedAnswer || []).includes(a.id)
                    : selectedAnswer === a.id;

                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        if (question.type === 'multiple_choice') {
                          setSelectedAnswer(prev => {
                            const arr = prev || [];
                            return arr.includes(a.id) ? arr.filter(id => id !== a.id) : [...arr, a.id];
                          });
                        } else {
                          setSelectedAnswer(a.id);
                        }
                      }}
                      className={`py-4 px-6 rounded-xl text-lg font-semibold transition ${
                        isSelected ? `${answerColors[i % answerColors.length]} ring-2 ring-white` : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      <span className="font-bold mr-2">{String.fromCharCode(65 + i)}</span> {a.text}
                    </button>
                  );
                })}
              </div>
            )}

            {isTextType && (
              <div className="mt-4">
                <input
                  type={question.type === 'free_text' ? 'text' : 'number'}
                  step="any"
                  placeholder={question.type === 'free_text' ? 'Type your answer...' : 'Enter a number...'}
                  value={textAnswer}
                  onChange={e => setTextAnswer(e.target.value)}
                  maxLength={100}
                  className="w-full px-4 py-3 text-lg bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-accent"
                  autoFocus
                />
              </div>
            )}

            {isMultiPart && (
              <div className="mt-4 flex flex-col gap-3">
                {partLabels.map(label => (
                  <div key={label}>
                    <label className="text-sm text-gray-400 mb-1 block">{label}</label>
                    <input
                      type="text"
                      placeholder={`Enter ${label.toLowerCase()}...`}
                      value={multiPartAnswers[label] || ''}
                      onChange={e => setMultiPartAnswers(prev => ({ ...prev, [label]: e.target.value }))}
                      maxLength={100}
                      className="w-full px-4 py-3 text-lg bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm text-center mt-2 cursor-pointer" onClick={() => setError('')}>{error}</p>
            )}

            <button
              onClick={submitAnswer}
              disabled={
                isChoiceType ? !selectedAnswer :
                isMultiPart ? !Object.values(multiPartAnswers).some(v => v.trim()) :
                !textAnswer.trim()
              }
              className="w-full mt-4 py-4 bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-lg transition"
            >
              Submit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
