import { useState } from 'react';

export default function Scoreboard({ scores, mini = false, breakdown, displayMode = false, maxVisible }) {
  if (!scores || scores.length === 0) return null;

  const medals = ['🥇', '🥈', '🥉'];
  const visibleScores = maxVisible ? scores.slice(0, maxVisible) : scores;

  if (mini) {
    return (
      <div className="bg-bg-card rounded-lg p-4">
        <h3 className="text-sm text-text-secondary mb-2 font-semibold">Scoreboard</h3>
        <div className="flex flex-col gap-1">
          {scores.slice(0, 5).map((s, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{i < 3 ? medals[i] : `${i + 1}.`} {s.name}</span>
              <span className="font-mono">{s.score.toLocaleString()}</span>
            </div>
          ))}
          {scores.length > 5 && <span className="text-text-secondary text-xs">+{scores.length - 5} more</span>}
        </div>
      </div>
    );
  }

  if (displayMode) {
    return (
      <div className="flex flex-col gap-4">
        {visibleScores.map((s, i) => (
          <div 
            key={i} 
            className={`rounded-xl p-6 ${i < 3 ? 'bg-gradient-to-r from-accent/20 to-accent/5 border-2 border-accent/50' : 'bg-bg-card/70 border-2 border-border-theme'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <span className="text-5xl w-16 text-center">{i < 3 ? medals[i] : <span className="text-text-secondary text-3xl font-bold">{i + 1}</span>}</span>
                <div>
                  <p className="font-bold text-3xl">{s.name}</p>
                  {s.team && <p className="text-text-secondary text-xl mt-1">{s.team}</p>}
                </div>
              </div>
              <span className="text-4xl font-bold font-mono">{s.score.toLocaleString()}</span>
            </div>
          </div>
        ))}
        {maxVisible && scores.length > maxVisible && (
          <p className="text-center text-text-secondary text-xl">+{scores.length - maxVisible} more players</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleScores.map((s, i) => (
        <PlayerRow key={i} player={s} rank={i} medals={medals} details={breakdown?.[s.name]} />
      ))}
      {maxVisible && scores.length > maxVisible && (
        <p className="text-center text-text-secondary text-sm">+{scores.length - maxVisible} more</p>
      )}
    </div>
  );
}

function PlayerRow({ player, rank, medals, details }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = details && details.length > 0;

  return (
    <div className={`rounded-lg ${rank < 3 ? 'bg-bg-card border border-border-theme' : 'bg-bg-card/50'}`}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-center justify-between p-4 w-full text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl w-10 text-center">{rank < 3 ? medals[rank] : <span className="text-text-secondary text-lg">{rank + 1}</span>}</span>
          <div>
            <p className="font-semibold">{player.name}</p>
            {player.team && <p className="text-text-secondary text-sm">{player.team}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-mono font-bold">{player.score.toLocaleString()}</span>
          {hasDetails && (
            <span className={`text-text-secondary transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>▾</span>
          )}
        </div>
      </button>
      {expanded && details && (
        <div className="px-4 pb-3 flex flex-col gap-1">
          {details.map((d, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
              d.answer === null ? 'bg-gray-500/10 text-text-secondary' : d.correct ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              <span className={`w-5 text-center shrink-0 font-bold ${
                d.answer === null ? 'text-text-secondary' : d.correct ? 'text-green-400' : 'text-red-400'
              }`}>
                {d.answer === null ? '–' : d.correct ? '✓' : '✗'}
              </span>
              <span className="flex-1 truncate" title={d.question}>
                <span className="text-text-secondary mr-1">Q{i + 1}</span>
                {d.answer !== null ? d.answer : <span className="italic text-text-secondary">no answer</span>}
              </span>
              {d.points > 0 && <span className="text-green-400 font-mono text-xs shrink-0">+{d.points}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
