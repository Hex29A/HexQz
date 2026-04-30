export default function Scoreboard({ scores, mini = false }) {
  if (!scores || scores.length === 0) return null;

  const medals = ['🥇', '🥈', '🥉'];

  if (mini) {
    return (
      <div className="bg-bg-card rounded-lg p-4">
        <h3 className="text-sm text-text-secondary mb-2 font-semibold">Scoreboard</h3>
        <div className="flex flex-col gap-1">
          {scores.slice(0, 5).map((s, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{i < 3 ? medals[i] : `${i + 1}.`} {s.name}</span>
              <span className="font-mono">{s.score}</span>
            </div>
          ))}
          {scores.length > 5 && <span className="text-text-secondary text-xs">+{scores.length - 5} more</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {scores.map((s, i) => (
        <div key={i} className={`flex items-center justify-between p-4 rounded-lg ${i < 3 ? 'bg-bg-card border border-border-theme' : 'bg-bg-card/50'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl w-10 text-center">{i < 3 ? medals[i] : <span className="text-text-secondary text-lg">{i + 1}</span>}</span>
            <div>
              <p className="font-semibold">{s.name}</p>
              {s.team && <p className="text-text-secondary text-sm">{s.team}</p>}
            </div>
          </div>
          <span className="text-xl font-mono font-bold">{s.score}</span>
        </div>
      ))}
    </div>
  );
}
