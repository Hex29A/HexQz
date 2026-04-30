import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard.jsx';

export default function ResultsView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const adminToken = searchParams.get('token');
  const [results, setResults] = useState(null);
  const participantId = sessionStorage.getItem('participantId');

  useEffect(() => {
    fetch(`/api/session/${sessionId}/results`).then(r => r.json()).then(data => {
      setResults(data);
      if (data.themeColor) {
        document.documentElement.style.setProperty('--accent', data.themeColor);
      }
    });
  }, [sessionId]);

  if (!results) return <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-xl">Loading results...</div></div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      {adminToken && (
        <nav className="mb-6 text-sm text-gray-400">
          <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
          <span className="mx-2">/</span>
          <a href={`/admin/${adminToken}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${adminToken}`); }} className="hover:text-white transition">Quiz</a>
          <span className="mx-2">/</span>
          <span className="text-white">Results</span>
        </nav>
      )}
      <h1 className="text-3xl font-bold text-center mb-2">{results.quizTitle}</h1>
      <p className="text-gray-400 text-center mb-8">Final Results</p>

      {results.logoUrl && (
        <div className="flex justify-center mb-6">
          <img src={results.logoUrl} alt="" className="max-h-16" />
        </div>
      )}

      <Scoreboard scores={results.scores} />

      <div className="mt-8 text-center">
        <a href="/" className="text-accent hover:underline">Play again</a>
      </div>
    </div>
  );
}
