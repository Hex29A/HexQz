// Server phase names -> view phase names shared by display and player views.
export const VIEW_PHASE = {
  waiting: 'waiting',
  get_ready: 'getReady',
  question: 'question',
  correct_answer: 'correctAnswer',
  round_result: 'roundResult',
  scoreboard: 'scoreboard',
  waiting_for_continue: 'scoreboard',
  finished: 'finished'
};

export function viewPhase(state) {
  if (!state) return 'waiting';
  if (state.status === 'waiting') return 'waiting';
  if (state.status === 'finished') return 'finished';
  // Hidden mode: nothing is revealed between questions, the answers are just locked.
  if (state.scoresHidden && state.currentPhase === 'waiting_for_continue') return 'locked';
  return VIEW_PHASE[state.currentPhase] || 'question';
}
