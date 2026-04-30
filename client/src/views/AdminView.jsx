import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const THEMES = [
  { id: 'indigo', label: 'Indigo', accent: '#6366f1', bg: '#0f172a', card: '#1e293b', text: '#f1f5f9', desc: 'Clean & modern' },
  { id: 'emerald', label: 'Emerald', accent: '#10b981', bg: '#021a13', card: 'rgba(6,78,59,0.5)', text: '#ecfdf5', desc: 'Forest glass' },
  { id: 'rose', label: 'Rose', accent: '#f43f5e', bg: '#1a0510', card: 'rgba(45,10,26,0.8)', text: '#fff1f2', desc: 'Soft & warm' },
  { id: 'amber', label: 'Amber', accent: '#f59e0b', bg: '#1a1000', card: 'rgba(45,28,4,0.8)', text: '#fffbeb', desc: 'Golden warmth' },
  { id: 'cyan', label: 'Cyan', accent: '#06b6d4', bg: '#041c24', card: 'rgba(10,46,58,0.6)', text: '#ecfeff', desc: 'Ice & tech' },
  { id: 'violet', label: 'Violet', accent: '#8b5cf6', bg: '#0a0520', card: 'rgba(21,13,48,0.8)', text: '#f5f3ff', desc: 'Deep mystic' },
  { id: 'synthwave', label: 'Synthwave', accent: '#f472b6', bg: '#0d001a', card: 'rgba(45,27,78,0.8)', text: '#fce7f3', desc: 'Neon retro' },
  { id: 'startrek', label: 'Star Trek', accent: '#f59f00', bg: '#000000', card: 'rgba(10,10,30,0.9)', text: '#ff9500', desc: 'LCARS angular' },
  { id: 'sunset', label: 'Sunset', accent: '#ea580c', bg: '#1a0800', card: 'rgba(45,20,8,0.8)', text: '#fff7ed', desc: 'Warm horizon' },
  { id: 'slate', label: 'Slate', accent: '#94a3b8', bg: '#0f1419', card: '#1c2128', text: '#e6edf3', desc: 'Minimal & clean' },
];

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'free_text', label: 'Free Text' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'estimation', label: 'Estimation' },
  { value: 'multi_part', label: 'Multi-Part (e.g. Artist + Song)' }
];

export default function AdminView() {
  const { adminToken } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [editing, setEditing] = useState(null); // question being edited
  const [showForm, setShowForm] = useState(false);

  const loadQuiz = async () => {
    const res = await fetch(`/api/quiz/${adminToken}`);
    if (res.ok) setQuiz(await res.json());
  };

  const loadSessions = async () => {
    const res = await fetch(`/api/quiz/${adminToken}/sessions`);
    if (res.ok) setSessions(await res.json());
  };

  useEffect(() => { loadQuiz(); loadSessions(); }, [adminToken]);

  const startSession = async () => {
    const res = await fetch(`/api/quiz/${adminToken}/session`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      navigate(`/host/${data.sessionId}?token=${adminToken}`);
    } else if (res.status === 409) {
      // Session already exists — ask what to do
      const action = confirm(
        'There is already an active session for this quiz.\n\nOK = Go to existing session\nCancel = End it and create a new one'
      );
      if (action) {
        navigate(`/host/${data.sessionId}?token=${adminToken}`);
      } else {
        // End the existing session
        await fetch(`/api/session/${data.sessionId}/end`, {
          method: 'POST',
          headers: { 'X-Admin-Token': adminToken }
        });
        // Create new session
        const res2 = await fetch(`/api/quiz/${adminToken}/session`, { method: 'POST' });
        const data2 = await res2.json();
        if (res2.ok) {
          navigate(`/host/${data2.sessionId}?token=${adminToken}`);
        }
      }
    }
  };

  const deleteQuestion = async (questionId) => {
    await fetch(`/api/quiz/${adminToken}/question/${questionId}`, { method: 'DELETE' });
    loadQuiz();
  };

  const updateTheme = async (color) => {
    await fetch(`/api/quiz/${adminToken}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: quiz.title, themeColor: color, lightMode: quiz.lightMode, logoUrl: quiz.logoUrl })
    });
    setQuiz({ ...quiz, themeColor: color });
  };

  const toggleLightMode = async () => {
    const newMode = !quiz.lightMode;
    await fetch(`/api/quiz/${adminToken}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: quiz.title, themeColor: quiz.themeColor, lightMode: newMode, logoUrl: quiz.logoUrl })
    });
    setQuiz({ ...quiz, lightMode: newMode });
  };

  const deleteSession = async (sessionId) => {
    if (!confirm('Delete this session and all its data?')) return;
    await fetch(`/api/quiz/${adminToken}/session/${sessionId}`, { method: 'DELETE' });
    loadSessions();
  };

  if (!quiz) return <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-xl">Loading...</div></div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <nav className="mb-6 text-sm text-gray-400">
        <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="hover:text-white transition">Dashboard</a>
        <span className="mx-2">/</span>
        <span className="text-white">{quiz.title}</span>
      </nav>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{quiz.title}</h1>
        <button onClick={startSession} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition">
          Start Session
        </button>
      </div>

      {/* Theme Picker */}
      <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">Theme</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => updateTheme(t.id)}
              className={`relative rounded-lg overflow-hidden border-2 transition-all ${quiz.themeColor === t.id ? 'border-white ring-2 ring-white/30 scale-[1.02]' : 'border-gray-600 hover:border-gray-400'}`}
            >
              {/* Mini preview */}
              <div className="p-2 h-24" style={{ background: t.bg }}>
                <div className="text-[9px] font-bold mb-1 truncate" style={{ color: t.text }}>{t.label}</div>
                <div className="rounded px-1.5 py-0.5 mb-1 text-[8px]" style={{ background: t.card, border: `1px solid ${t.accent}40`, color: t.text }}>
                  Sample Q?
                </div>
                <div className="flex gap-1">
                  <div className="flex-1 rounded py-0.5 text-[7px] text-center" style={{ background: t.accent, color: '#fff' }}>A</div>
                  <div className="flex-1 rounded py-0.5 text-[7px] text-center" style={{ border: `1px solid ${t.accent}`, color: t.text }}>B</div>
                </div>
              </div>
              {/* Label */}
              <div className="px-2 py-1.5 bg-gray-900 text-center">
                <span className="text-xs font-medium text-gray-200">{t.label}</span>
                <span className="block text-[10px] text-gray-500">{t.desc}</span>
              </div>
              {/* Selected check */}
              {quiz.themeColor === t.id && (
                <div className="absolute top-1 right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                  <span className="text-xs text-gray-900">✓</span>
                </div>
              )}
            </button>
          ))}
        </div>
        {/* Custom color option */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="color"
              value={quiz.themeColor?.startsWith('#') ? quiz.themeColor : '#6366f1'}
              onChange={(e) => updateTheme(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
            />
            <span className="text-sm text-gray-400">Custom accent color</span>
          </label>
          {quiz.themeColor?.startsWith('#') && (
            <span className="text-xs text-gray-500 font-mono">{quiz.themeColor}</span>
          )}
          {/* Dark/Light toggle */}
          <button
            onClick={toggleLightMode}
            className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-lg border transition ${quiz.lightMode ? 'bg-yellow-50 border-yellow-300 text-yellow-800' : 'bg-gray-700 border-gray-600 text-gray-300'}`}
          >
            <span className="text-lg">{quiz.lightMode ? '☀️' : '🌙'}</span>
            <span className="text-sm font-medium">{quiz.lightMode ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        {quiz.questions.map((q, idx) => (
          <div key={q.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <span className="text-gray-500 text-sm">Q{idx + 1} — {q.type.replace('_', ' ')}</span>
                <p className="font-medium mt-1">{q.text}</p>
                {q.imageUrl && <img src={q.imageUrl} alt="" className="mt-2 max-h-32 rounded" />}
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.answers.map(a => (
                    <span key={a.id} className={`px-2 py-1 rounded text-sm ${a.isCorrect ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-300'}`}>
                      {a.text}
                    </span>
                  ))}
                </div>
                {q.type === 'numeric' || q.type === 'estimation' ? (
                  <p className="text-gray-500 text-sm mt-1">Correct: {q.correctValue} (±{q.tolerance})</p>
                ) : null}
              </div>
              <div className="flex gap-2 ml-4">
                <button onClick={() => { setEditing(q); setShowForm(true); }} className="text-gray-400 hover:text-white transition">Edit</button>
                <button onClick={() => deleteQuestion(q.id)} className="text-red-400 hover:text-red-300 transition">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => { setEditing(null); setShowForm(true); }} className="w-full py-3 border-2 border-dashed border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-accent transition">
        + Add Question
      </button>

      {/* Sessions */}
      {sessions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-3">Sessions</h2>
          <div className="flex flex-col gap-2">
            {sessions.map(s => (
              <div key={s.id} className="p-3 bg-gray-800 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      s.status === 'active' ? 'bg-green-900 text-green-300' :
                      s.status === 'waiting' ? 'bg-yellow-900 text-yellow-300' :
                      'bg-gray-700 text-gray-400'
                    }`}>{s.status}</span>
                    <span className="font-mono text-sm">{s.joinCode}</span>
                    <span className="text-gray-500 text-sm">{s.participantCount} players</span>
                  </div>
                  <div className="flex gap-3">
                    {(s.status === 'waiting' || s.status === 'active') && (
                      <button onClick={() => navigate(`/host/${s.id}?token=${adminToken}`)} className="text-sm text-accent hover:underline">
                        Host
                      </button>
                    )}
                    {s.status === 'finished' && (
                      <button onClick={() => navigate(`/host/${s.id}?token=${adminToken}`)} className="text-sm text-yellow-400 hover:underline">
                        Review
                      </button>
                    )}
                    <button onClick={() => navigate(`/results/${s.id}?token=${adminToken}`)} className="text-sm text-gray-400 hover:text-white">
                      Results
                    </button>
                    <button onClick={() => deleteSession(s.id)} className="text-sm text-red-400 hover:text-red-300">
                      Delete
                    </button>
                  </div>
                </div>
                {s.winner && (
                  <p className="text-sm text-gray-400 mt-1">Winner: <span className="text-white">{s.winner.name}</span> <span className="text-gray-500">({s.winner.score} pts)</span></p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <QuestionForm
          adminToken={adminToken}
          question={editing}
          onDone={() => { setShowForm(false); setEditing(null); loadQuiz(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function QuestionForm({ adminToken, question, onDone, onCancel }) {
  const [text, setText] = useState(question?.text || '');
  const [imageUrl, setImageUrl] = useState(question?.imageUrl || '');
  const [uploading, setUploading] = useState(false);
  const [type, setType] = useState(question?.type || 'single_choice');
  const [answers, setAnswers] = useState(
    question?.answers?.map(a => ({ text: a.text, isCorrect: a.isCorrect, partLabel: a.partLabel })) ||
    [{ text: '', isCorrect: true }, { text: '', isCorrect: false }, { text: '', isCorrect: false }, { text: '', isCorrect: false }]
  );
  const [correctValue, setCorrectValue] = useState(question?.correctValue ?? '');
  const [tolerance, setTolerance] = useState(question?.tolerance ?? 0);
  const [parts, setParts] = useState(() => {
    // Reconstruct parts from answers with partLabel
    if (question?.type === 'multi_part' && question?.answers) {
      const p = {};
      for (const a of question.answers) {
        if (a.partLabel) {
          if (!p[a.partLabel]) p[a.partLabel] = [];
          p[a.partLabel].push(a.text);
        }
      }
      return Object.entries(p).map(([label, accepted]) => ({ label, accepted }));
    }
    return [{ label: 'Artist', accepted: [''] }, { label: 'Song', accepted: [''] }];
  });

  useEffect(() => {
    if (type === 'true_false') {
      setAnswers([{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }]);
    }
  }, [type]);

  const submit = async (e) => {
    e.preventDefault();
    let submitAnswers;
    if (type === 'multi_part') {
      // Convert parts to flat answers array with partLabel
      submitAnswers = parts.flatMap(p =>
        p.accepted.filter(a => a.trim()).map(a => ({ text: a.trim(), isCorrect: true, partLabel: p.label }))
      );
    } else {
      submitAnswers = answers.filter(a => a.text.trim());
    }

    const body = {
      text,
      imageUrl: imageUrl || undefined,
      type,
      answers: submitAnswers,
      correctValue: (type === 'numeric' || type === 'estimation') ? parseFloat(correctValue) : undefined,
      tolerance: type === 'numeric' ? parseFloat(tolerance) : undefined
    };

    const url = question
      ? `/api/quiz/${adminToken}/question/${question.id}`
      : `/api/quiz/${adminToken}/question`;
    const method = question ? 'PUT' : 'POST';

    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) onDone();
  };

  const showOptions = ['single_choice', 'multiple_choice', 'true_false'].includes(type);
  const showFreeText = type === 'free_text';
  const showNumeric = type === 'numeric' || type === 'estimation';
  const showMultiPart = type === 'multi_part';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="bg-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">{question ? 'Edit' : 'Add'} Question</h2>

        <div className="flex flex-col gap-4">
          <select value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 bg-gray-700 rounded-lg">
            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <textarea
            placeholder="Question text"
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={1000}
            rows={3}
            className="px-3 py-2 bg-gray-700 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            autoFocus
          />

          <ImageUpload imageUrl={imageUrl} setImageUrl={setImageUrl} uploading={uploading} setUploading={setUploading} />

          {showOptions && (
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400">Answers (click to mark correct)</label>
              {answers.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (type === 'multiple_choice') {
                        setAnswers(answers.map((ans, j) => j === i ? { ...ans, isCorrect: !ans.isCorrect } : ans));
                      } else {
                        setAnswers(answers.map((ans, j) => ({ ...ans, isCorrect: j === i })));
                      }
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${a.isCorrect ? 'bg-green-600' : 'bg-gray-600'}`}
                  >
                    {String.fromCharCode(65 + i)}
                  </button>
                  <input
                    type="text"
                    value={a.text}
                    onChange={e => setAnswers(answers.map((ans, j) => j === i ? { ...ans, text: e.target.value } : ans))}
                    placeholder={`Answer ${String.fromCharCode(65 + i)}`}
                    maxLength={500}
                    disabled={type === 'true_false'}
                    className="flex-1 px-3 py-1 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  {type !== 'true_false' && answers.length > 2 && (
                    <button type="button" onClick={() => setAnswers(answers.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300">×</button>
                  )}
                </div>
              ))}
              {type !== 'true_false' && answers.length < 6 && (
                <button type="button" onClick={() => setAnswers([...answers, { text: '', isCorrect: false }])} className="text-sm text-accent hover:underline">
                  + Add answer
                </button>
              )}
            </div>
          )}

          {showFreeText && (
            <div>
              <label className="text-sm text-gray-400">Accepted answers (one per field, case-insensitive match)</label>
              {answers.map((a, i) => (
                <div key={i} className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={a.text}
                    onChange={e => setAnswers(answers.map((ans, j) => j === i ? { ...ans, text: e.target.value, isCorrect: true } : ans))}
                    placeholder="Accepted answer"
                    maxLength={500}
                    className="flex-1 px-3 py-1 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {answers.length > 1 && (
                    <button type="button" onClick={() => setAnswers(answers.filter((_, j) => j !== i))} className="text-red-400">×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setAnswers([...answers, { text: '', isCorrect: true }])} className="text-sm text-accent hover:underline mt-2">
                + Add accepted answer
              </button>
            </div>
          )}

          {showNumeric && (
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm text-gray-400">Correct value</label>
                <input type="number" step="any" value={correctValue} onChange={e => setCorrectValue(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
              {type === 'numeric' && (
                <div className="flex-1">
                  <label className="text-sm text-gray-400">Tolerance (±)</label>
                  <input type="number" step="any" value={tolerance} onChange={e => setTolerance(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
              )}
            </div>
          )}

          {showMultiPart && (
            <div className="flex flex-col gap-3">
              <label className="text-sm text-gray-400">Answer parts (each part is scored independently)</label>
              {parts.map((part, pi) => (
                <div key={pi} className="p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={part.label}
                      onChange={e => setParts(parts.map((p, j) => j === pi ? { ...p, label: e.target.value } : p))}
                      placeholder="Part label (e.g. Artist)"
                      className="flex-1 px-3 py-1 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent font-semibold"
                    />
                    {parts.length > 1 && (
                      <button type="button" onClick={() => setParts(parts.filter((_, j) => j !== pi))} className="text-red-400">×</button>
                    )}
                  </div>
                  {part.accepted.map((acc, ai) => (
                    <div key={ai} className="flex gap-2 ml-4 mt-1">
                      <input
                        type="text"
                        value={acc}
                        onChange={e => setParts(parts.map((p, j) => j === pi ? { ...p, accepted: p.accepted.map((a, k) => k === ai ? e.target.value : a) } : p))}
                        placeholder="Accepted answer"
                        maxLength={500}
                        className="flex-1 px-3 py-1 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-sm"
                      />
                      {part.accepted.length > 1 && (
                        <button type="button" onClick={() => setParts(parts.map((p, j) => j === pi ? { ...p, accepted: p.accepted.filter((_, k) => k !== ai) } : p))} className="text-red-400 text-sm">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setParts(parts.map((p, j) => j === pi ? { ...p, accepted: [...p.accepted, ''] } : p))} className="text-xs text-accent hover:underline ml-4 mt-1">
                    + Add alternative spelling
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setParts([...parts, { label: '', accepted: [''] }])} className="text-sm text-accent hover:underline">
                + Add part
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className="flex-1 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition">Cancel</button>
          <button type="submit" className="flex-1 py-2 bg-accent rounded-lg hover:opacity-90 font-semibold transition">Save</button>
        </div>
      </form>
    </div>
  );
}

function ImageUpload({ imageUrl, setImageUrl, uploading, setUploading }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const uploadFile = async (file) => {
    if (!file) return;
    setError('');
    setUploading(true);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setImageUrl(data.url);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      uploadFile(file);
    } else {
      setError('Only image files are allowed');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-4 text-center transition cursor-pointer ${
          dragOver ? 'border-accent bg-accent/10' : 'border-gray-600 hover:border-gray-500'
        }`}
        onClick={() => document.getElementById('image-file-input').click()}
      >
        {uploading ? (
          <p className="text-gray-400 text-sm">Uploading...</p>
        ) : (
          <p className="text-gray-400 text-sm">Drop image here or click to select</p>
        )}
        <input
          id="image-file-input"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
      <input
        type="text"
        placeholder="Or paste image URL"
        value={imageUrl}
        onChange={e => setImageUrl(e.target.value)}
        className="px-3 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-sm"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {imageUrl && (
        <div className="relative inline-block">
          <img src={imageUrl} alt="preview" className="max-h-32 rounded" onError={e => e.target.style.display = 'none'} />
          <button
            type="button"
            onClick={() => setImageUrl('')}
            className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center text-white text-xs hover:bg-red-600 transition"
          >&times;</button>
        </div>
      )}
    </div>
  );
}
