import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../socket.js';
import Scoreboard from '../components/Scoreboard.jsx';

export default function HostView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const adminToken = searchParams.get('token');
  const [state, setState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [answerCount, setAnswerCount] = useState({ count: 0, total: 0 });
  const [scores, setScores] = useState([]);
  const [started, setStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [finished, setFinished] = useState(false);
  const [connected, setConnected] = useState(true);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    // Load initial state
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      setState(data);
      setScores(data.scores || []);
      if (data.participants) setParticipants(data.participants);
      if (data.status === 'active') {
        setStarted(true);
        setCurrentQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
      }
      if (data.status === 'finished') {
        setFinished(true);
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
        if (data.status === 'active') {
          setStarted(true);
          setCurrentQuestion(data.question);
          setQuestionIndex(data.questionIndex);
          setTotalQuestions(data.totalQuestions);
        }
        if (data.status === 'finished') setFinished(true);
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
      setAnswerCount({ count: 0, total: 0 });
    });

    socket.on('session:question', (data) => {
      setCurrentQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setAnswerCount({ count: 0, total: 0 });
    });

    socket.on('session:answer_count', (data) => {
      setAnswerCount({ count: data.count, total: data.total });
    });

    socket.on('session:scores', (data) => {
      setScores(data.scores);
    });

    socket.on('session:finished', (data) => {
      setFinished(true);
      setScores(data.results);
    });

    socket.on('session:state', (data) => {
      setScores(data.scores || []);
      if (data.status === 'active') {
        setStarted(true);
        setCurrentQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
      }
      if (data.status === 'finished') setFinished(true);
    });

    return () => {
      socket.off('session:participant_joined');
      socket.off('session:started');
      socket.off('session:question');
      socket.off('session:answer_count');
      socket.off('session:scores');
      socket.off('session:finished');
      socket.off('session:state');
      socket.off('disconnect');
      socket.disconnect();
    };
  }, [sessionId, adminToken]);

  const startQuiz = async () => {
    await fetch(`/api/session/${sessionId}/start`, {
      method: 'POST',
      headers: { 'X-Admin-Token': adminToken }
    });
  };

  const nextQuestion = async () => {
    await fetch(`/api/session/${sessionId}/next`, {
      method: 'POST',
      headers: { 'X-Admin-Token': adminToken }
    });
  };

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join` : '';
  const [joinCodeDisplay, setJoinCodeDisplay] = useState('');

  useEffect(() => {
    fetch(`/api/session/${sessionId}/current`).then(r => r.json()).then(data => {
      if (data.joinCode) setJoinCodeDisplay(data.joinCode);
    });
  }, [sessionId]);

  if (finished) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        {!connected && <div className="bg-red-900 text-red-200 text-center py-2 px-4 rounded-lg mb-4 text-sm">Reconnecting...</div>}
        <h1 className="text-3xl font-bold mb-6 text-center">Quiz Finished!</h1>
        <div className="mb-6 flex justify-center">
          <QRCodeSVG value={`${window.location.origin}/results/${sessionId}`} size={200} bgColor="transparent" fgColor="white" />
        </div>
        <p className="text-center text-gray-400 mb-6">Scan for results</p>
        <Scoreboard scores={scores} />
      </div>
    );
  }

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <h1 className="text-3xl font-bold mb-8">Waiting for players...</h1>
        <div className="mb-4">
          <QRCodeSVG value={joinUrl} size={250} bgColor="transparent" fgColor="white" />
        </div>
        {joinCodeDisplay && (
          <p className="text-4xl font-mono font-bold tracking-widest mb-4">{joinCodeDisplay}</p>
        )}
        <p className="text-gray-400 mb-2">Go to <span className="text-white font-mono">{joinUrl}</span></p>
        <p className="text-gray-400 mb-8">{participants.length} player{participants.length !== 1 ? 's' : ''} joined</p>
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {participants.map(p => (
            <span key={p.participantId || p.id} className="px-3 py-1 bg-gray-800 rounded-full text-sm">
              {p.displayName} {p.teamName ? `(${p.teamName})` : ''}
            </span>
          ))}
        </div>
        <button onClick={startQuiz} disabled={participants.length === 0}
          className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition">
          Start Quiz
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {!connected && <div className="bg-red-900 text-red-200 text-center py-2 px-4 rounded-lg mb-4 text-sm">Reconnecting...</div>}
      <div className="flex justify-between items-center mb-4">
        <span className="text-gray-400">Question {questionIndex + 1} of {totalQuestions}</span>
        <span className="text-gray-400">{answerCount.count}/{answerCount.total || participants.length} answered</span>
      </div>

      {currentQuestion && (
        <div className="bg-gray-800 rounded-xl p-6 mb-6">
          <h2 className="text-2xl font-bold">{currentQuestion.text}</h2>
          {currentQuestion.imageUrl && <img src={currentQuestion.imageUrl} alt="" className="mt-4 rounded-lg max-h-64 mx-auto" />}
        </div>
      )}

      <div className="flex gap-4 mb-6">
        <button onClick={nextQuestion} className="flex-1 py-3 bg-accent hover:opacity-90 rounded-lg font-semibold text-lg transition">
          {questionIndex + 1 >= totalQuestions ? 'Finish Quiz' : 'Next Question'}
        </button>
        {currentQuestion && ['free_text', 'multi_part'].includes(currentQuestion.type) && (
          <button onClick={() => setShowReview(true)} className="px-4 py-3 bg-yellow-700 hover:bg-yellow-600 rounded-lg font-semibold transition">
            Review
          </button>
        )}
      </div>

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
            {responses.filter(r => r.textAnswer).map(r => (
              <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                r.isCorrect ? 'bg-green-900/30 border-green-800' : r.reviewed ? 'bg-red-900/30 border-red-800' : 'bg-gray-700 border-gray-600'
              }`}>
                <div className="flex-1">
                  <span className="text-sm text-gray-400">{r.displayName}</span>
                  <p className="font-medium">{formatAnswer(r.textAnswer)}</p>
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
