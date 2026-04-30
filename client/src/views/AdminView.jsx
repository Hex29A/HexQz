import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'free_text', label: 'Free Text' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'estimation', label: 'Estimation' }
];

export default function AdminView() {
  const { adminToken } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [editing, setEditing] = useState(null); // question being edited
  const [showForm, setShowForm] = useState(false);

  const loadQuiz = async () => {
    const res = await fetch(`/api/quiz/${adminToken}`);
    if (res.ok) setQuiz(await res.json());
  };

  useEffect(() => { loadQuiz(); }, [adminToken]);

  const startSession = async () => {
    const res = await fetch(`/api/quiz/${adminToken}/session`, { method: 'POST' });
    if (res.ok) {
      const { sessionId } = await res.json();
      navigate(`/host/${sessionId}?token=${adminToken}`);
    }
  };

  const deleteQuestion = async (questionId) => {
    await fetch(`/api/quiz/${adminToken}/question/${questionId}`, { method: 'DELETE' });
    loadQuiz();
  };

  if (!quiz) return <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-xl">Loading...</div></div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{quiz.title}</h1>
        <button onClick={startSession} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition">
          Start Session
        </button>
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
  const [type, setType] = useState(question?.type || 'single_choice');
  const [answers, setAnswers] = useState(
    question?.answers?.map(a => ({ text: a.text, isCorrect: a.isCorrect })) ||
    [{ text: '', isCorrect: true }, { text: '', isCorrect: false }, { text: '', isCorrect: false }, { text: '', isCorrect: false }]
  );
  const [correctValue, setCorrectValue] = useState(question?.correctValue ?? '');
  const [tolerance, setTolerance] = useState(question?.tolerance ?? 0);

  useEffect(() => {
    if (type === 'true_false') {
      setAnswers([{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }]);
    }
  }, [type]);

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      text,
      imageUrl: imageUrl || undefined,
      type,
      answers: (type === 'free_text' || type === 'numeric' || type === 'estimation')
        ? answers.filter(a => a.text.trim())
        : answers.filter(a => a.text.trim()),
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

          <input
            type="text"
            placeholder="Image URL (optional)"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            className="px-3 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {imageUrl && <img src={imageUrl} alt="preview" className="max-h-32 rounded" onError={e => e.target.style.display = 'none'} />}

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
        </div>

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className="flex-1 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition">Cancel</button>
          <button type="submit" className="flex-1 py-2 bg-accent rounded-lg hover:opacity-90 font-semibold transition">Save</button>
        </div>
      </form>
    </div>
  );
}
