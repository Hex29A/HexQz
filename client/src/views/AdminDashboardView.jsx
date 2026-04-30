import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboardView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [quizzes, setQuizzes] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const navigate = useNavigate();

  const login = async (e) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      setLoggedIn(true);
      loadQuizzes();
    } else {
      setError('Invalid password');
    }
  };

  const loadQuizzes = async () => {
    const res = await fetch('/api/admin/quizzes');
    if (res.ok) {
      setQuizzes(await res.json());
      setLoggedIn(true);
    }
  };

  const createQuiz = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const res = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    if (res.ok) {
      const { adminToken } = await res.json();
      navigate(`/admin/${adminToken}`);
    }
  };

  const deleteQuiz = async (adminToken, e) => {
    e.stopPropagation();
    if (!confirm('Delete this quiz and all its data?')) return;
    const res = await fetch(`/api/quiz/${adminToken}`, { method: 'DELETE' });
    if (res.ok) loadQuizzes();
  };

  useEffect(() => { loadQuizzes(); }, []);

  if (!loggedIn) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
        <form onSubmit={login} className="w-full max-w-sm flex flex-col gap-3">
          <input
            type="password"
            placeholder="Master password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-accent"
            autoFocus
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" className="w-full py-3 bg-accent hover:opacity-90 rounded-lg font-semibold transition">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

      <form onSubmit={createQuiz} className="flex gap-2 mb-8">
        <input
          type="text"
          placeholder="New quiz title"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          maxLength={200}
          className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-accent"
        />
        <button type="submit" className="px-6 py-2 bg-accent hover:opacity-90 rounded-lg font-semibold transition">
          Create
        </button>
      </form>

      {quizzes.length === 0 ? (
        <p className="text-gray-500">No quizzes yet. Create one above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {quizzes.map(q => (
            <div
              key={q.id}
              onClick={() => navigate(`/admin/${q.adminToken}`)}
              className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 transition border border-gray-700 hover:border-accent"
            >
              <div className="flex justify-between items-center">
                <h2 className="font-semibold text-lg">{q.title}</h2>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-sm">{q.sessionCount} session{q.sessionCount !== 1 ? 's' : ''}</span>
                  <button onClick={(e) => deleteQuiz(q.adminToken, e)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                </div>
              </div>
              <p className="text-gray-500 text-sm mt-1">{new Date(q.createdAt * 1000).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
