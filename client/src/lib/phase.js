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
  // Standings hidden until the end: keep the revealed answer on screen between questions.
  if (state.scoresHidden && state.currentPhase === 'waiting_for_continue') return 'correctAnswer';
  return VIEW_PHASE[state.currentPhase] || 'question';
}
