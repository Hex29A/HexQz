import db from './db/db.js';
import { randomUUID } from 'crypto';

// Seed a demo quiz with all question types
const existing = db.prepare("SELECT id FROM quiz WHERE title = ?").get('Demo Quiz – All Question Types');
if (!existing) {
  const quizId = randomUUID();
  const adminToken = randomUUID();

  db.prepare(`INSERT INTO quiz (id, title, admin_token, theme_color) VALUES (?, ?, ?, ?)`)
    .run(quizId, 'Demo Quiz – All Question Types', adminToken, '#6366f1');

  const questions = [
    {
      text: 'What is the capital of France?',
      type: 'single_choice',
      answers: [
        { text: 'London', isCorrect: false },
        { text: 'Paris', isCorrect: true },
        { text: 'Berlin', isCorrect: false },
        { text: 'Madrid', isCorrect: false }
      ]
    },
    {
      text: 'Which of these are programming languages?',
      type: 'multiple_choice',
      answers: [
        { text: 'Python', isCorrect: true },
        { text: 'Cobra', isCorrect: false },
        { text: 'Rust', isCorrect: true },
        { text: 'Timber', isCorrect: false }
      ]
    },
    {
      text: 'The Great Wall of China is visible from space.',
      type: 'true_false',
      answers: [
        { text: 'True', isCorrect: false },
        { text: 'False', isCorrect: true }
      ]
    },
    {
      text: 'What element does "Au" represent on the periodic table?',
      type: 'free_text',
      answers: [
        { text: 'Gold', isCorrect: true },
        { text: 'gold', isCorrect: true }
      ]
    },
    {
      text: 'How many bones are in the adult human body?',
      type: 'numeric',
      correctValue: 206,
      tolerance: 5,
      answers: []
    },
    {
      text: 'In what year was the first iPhone released?',
      type: 'estimation',
      correctValue: 2007,
      tolerance: 0,
      answers: []
    },
    {
      text: 'Name the artist and song: "Is this the real life? Is this just fantasy?"',
      type: 'multi_part',
      answers: [
        { text: 'Queen', isCorrect: true, partLabel: 'Artist' },
        { text: 'queen', isCorrect: true, partLabel: 'Artist' },
        { text: 'Bohemian Rhapsody', isCorrect: true, partLabel: 'Song' },
        { text: 'bohemian rhapsody', isCorrect: true, partLabel: 'Song' }
      ]
    }
  ];

  const insertQuestion = db.prepare(`
    INSERT INTO question (id, quiz_id, sort_order, text, type, correct_value, tolerance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAnswer = db.prepare(`
    INSERT INTO answer (id, question_id, text, is_correct, part_label)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const questionId = randomUUID();
    insertQuestion.run(questionId, quizId, i, q.text, q.type, q.correctValue ?? null, q.tolerance ?? 0);
    for (const a of q.answers) {
      insertAnswer.run(randomUUID(), questionId, a.text, a.isCorrect ? 1 : 0, a.partLabel || null);
    }
  }

  console.log(`Demo quiz seeded. Admin URL: /admin/${adminToken}`);
} else {
  console.log('Demo quiz already exists, skipping seed.');
}
