#!/usr/bin/env node

/**
 * HexQz Stress Test
 * 
 * Simulates multiple concurrent players joining a quiz session and answering questions.
 * Can automatically create a quiz and session for testing, or use an existing join code.
 * 
 * Usage:
 *   Auto mode (creates quiz): node stress-test.js --auto <numPlayers> [baseUrl]
 *   Manual mode: node stress-test.js <joinCode> <numPlayers> [baseUrl]
 * 
 * Examples:
 *   node stress-test.js --auto 50 http://nginx
 *   node stress-test.js ABC123 50 https://quiz.zikkan.com
 * 
 * Environment variables:
 *   ADMIN_SECRET - Required for --auto mode to create quiz
 * 
 * Note: In auto mode, the quiz is created but you must manually start it from the Host View GUI.
 *       Players will answer randomly between 0-15 seconds, with ~10% attempting late answers.
 */

import { io } from 'socket.io-client';

const args = process.argv.slice(2);

let AUTO_MODE = false;
let JOIN_CODE = null;
let NUM_PLAYERS;
let BASE_URL;
let ADMIN_SECRET = process.env.ADMIN_SECRET;

// Parse arguments
if (args[0] === '--auto') {
  AUTO_MODE = true;
  NUM_PLAYERS = parseInt(args[1], 10);
  BASE_URL = args[2] || 'http://localhost:3042';
  
  if (!ADMIN_SECRET) {
    console.error('❌ --auto mode requires ADMIN_SECRET environment variable');
    console.error('Example: ADMIN_SECRET=your-secret node stress-test.js --auto 50');
    process.exit(1);
  }
} else {
  if (args.length < 2) {
    console.error('Usage:');
    console.error('  Auto mode: node stress-test.js --auto <numPlayers> [baseUrl]');
    console.error('  Manual mode: node stress-test.js <joinCode> <numPlayers> [baseUrl]');
    console.error('\nExamples:');
    console.error('  node stress-test.js --auto 50 http://nginx');
    console.error('  node stress-test.js ABC123 50 https://quiz.zikkan.com');
    process.exit(1);
  }
  
  JOIN_CODE = args[0].toUpperCase();
  NUM_PLAYERS = parseInt(args[1], 10);
  BASE_URL = args[2] || 'http://localhost:3042';
}

if (isNaN(NUM_PLAYERS) || NUM_PLAYERS < 1 || NUM_PLAYERS > 1000) {
  console.error('Invalid number of players. Must be between 1 and 1000.');
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`🧪 HexQz Stress Test`);
console.log(`${'='.repeat(60)}`);
if (AUTO_MODE) {
  console.log(`Mode: AUTO (will create quiz and session)`);
} else {
  console.log(`Mode: MANUAL`);
  console.log(`Join Code: ${JOIN_CODE}`);
}
console.log(`Players: ${NUM_PLAYERS}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`${'='.repeat(60)}\n`);

class VirtualPlayer {
  constructor(id, sessionId, baseUrl) {
    this.id = id;
    this.name = `Player${id}`;
    this.sessionId = sessionId;
    this.baseUrl = baseUrl;
    this.participantId = null;
    this.socket = null;
    this.currentQuestionId = null;
    this.connected = false;
    this.answeredCount = 0;
  }

  async register() {
    try {
      const res = await fetch(`${this.baseUrl}/api/join/${JOIN_CODE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: this.name })
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.participantId) {
          // Already registered
          this.participantId = err.participantId;
          return true;
        }
        console.error(`[${this.name}] Registration failed:`, err.error);
        return false;
      }

      const data = await res.json();
      this.participantId = data.participantId;
      return true;
    } catch (error) {
      console.error(`[${this.name}] Registration error:`, error.message);
      return false;
    }
  }

  connect() {
    return new Promise((resolve) => {
      this.socket = io(this.baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this.socket.emit('join:session', { 
          sessionId: this.sessionId, 
          participantId: this.participantId 
        });
        resolve();
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
      });

      this.socket.on('session:question', (data) => {
        this.handleQuestion(data);
      });

      this.socket.on('session:started', (data) => {
        this.handleQuestion(data);
      });

      this.socket.on('session:scores', () => {
        // Scoreboard shown, wait for next question
      });

      this.socket.on('session:finished', () => {
        console.log(`[${this.name}] Quiz finished. Answered ${this.answeredCount} questions.`);
        this.disconnect();
      });
    });
  }

  async handleQuestion(data) {
    this.currentQuestionId = data.question.id;
    const answers = data.answers || [];
    
    const questionPreview = data.question.text.length > 50 
      ? data.question.text.substring(0, 50) + '...' 
      : data.question.text;
    console.log(`[${this.name}] 📝 Question received: "${questionPreview}"`);
    
    // Random answer delay: 0-15 seconds (with ~10% trying to answer late after 16-20s)
    const shouldTestTimeout = Math.random() < 0.1; // 10% chance
    const delay = shouldTestTimeout 
      ? Math.random() * 4000 + 16000 // 16-20 seconds (late answer)
      : Math.random() * 15000; // 0-15 seconds (valid)
    
    setTimeout(() => {
      this.submitRandomAnswer(data.question, answers, shouldTestTimeout);
    }, delay);
  }

  async submitRandomAnswer(question, answers, isLateAttempt = false) {
    if (!this.currentQuestionId || question.id !== this.currentQuestionId) {
      return; // Question changed, skip
    }

    const body = {
      participantId: this.participantId,
      questionId: question.id
    };

    if (question.type === 'single_choice' || question.type === 'true_false') {
      if (answers.length > 0) {
        body.answerId = answers[Math.floor(Math.random() * answers.length)].id;
      }
    } else if (question.type === 'multiple_choice') {
      // Select 1-3 random answers
      const numToSelect = Math.floor(Math.random() * 3) + 1;
      const selected = [];
      for (let i = 0; i < numToSelect && i < answers.length; i++) {
        selected.push(answers[Math.floor(Math.random() * answers.length)].id);
      }
      body.answerId = [...new Set(selected)];
    } else if (question.type === 'free_text') {
      body.textAnswer = `Answer from ${this.name}`;
    } else if (question.type === 'numeric' || question.type === 'estimation') {
      body.textAnswer = String(Math.floor(Math.random() * 1000));
    } else if (question.type === 'multi_part') {
      const parts = {};
      const labels = [...new Set(answers.map(a => a.partLabel).filter(Boolean))];
      labels.forEach(label => {
        parts[label] = `${label} answer`;
      });
      body.textAnswer = JSON.stringify(parts);
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        this.answeredCount++;
        console.log(`[${this.name}] ✅ Answered question #${this.answeredCount}`);
      } else {
        if (isLateAttempt) {
          console.log(`[${this.name}] ⏱️  Late answer rejected (as expected)`);
        } else {
          console.log(`[${this.name}] ❌ Failed to submit answer`);
        }
      }
    } catch (error) {
      console.log(`[${this.name}] ❌ Error: ${error.message}`);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// Create a test quiz with questions
async function createTestQuiz() {
  console.log('🎯 Creating test quiz...');
  
  try {
    // Create quiz using X-Admin-Secret header (simpler than cookie auth for API clients)
    const createQuizRes = await fetch(`${BASE_URL}/api/quiz`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Secret': ADMIN_SECRET
      },
      body: JSON.stringify({
        title: `Stress Test Quiz ${Date.now()}`
      })
    });
    
    if (!createQuizRes.ok) {
      const err = await createQuizRes.text();
      throw new Error(`Failed to create quiz: ${err}`);
    }
    
    const quiz = await createQuizRes.json();
    const quizId = quiz.quizId;
    const adminToken = quiz.adminToken;
    
    // Add test questions
    const questions = [
      {
        text: 'What is 2 + 2?',
        type: 'single_choice',
        answers: [
          { text: '3', isCorrect: false },
          { text: '4', isCorrect: true },
          { text: '5', isCorrect: false },
          { text: '6', isCorrect: false }
        ]
      },
      {
        text: 'Which are primary colors?',
        type: 'multiple_choice',
        answers: [
          { text: 'Red', isCorrect: true },
          { text: 'Blue', isCorrect: true },
          { text: 'Green', isCorrect: false },
          { text: 'Yellow', isCorrect: true }
        ]
      },
      {
        text: 'The Earth is flat',
        type: 'true_false',
        answers: [
          { text: 'True', isCorrect: false },
          { text: 'False', isCorrect: true }
        ]
      },
      {
        text: 'What is the capital of France?',
        type: 'free_text',
        answers: [
          { text: 'Paris', isCorrect: true }
        ]
      },
      {
        text: 'How many continents are there?',
        type: 'numeric',
        correctValue: 7,
        tolerance: 0
      }
    ];
    
    console.log(`✅ Quiz created, adding ${questions.length} questions...\n`);
    
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const addQuestionRes = await fetch(`${BASE_URL}/api/quiz/${adminToken}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: q.text,
          type: q.type,
          correctValue: q.correctValue,
          tolerance: q.tolerance,
          answers: q.answers,
          sortOrder: i
        })
      });
      
      if (!addQuestionRes.ok) {
        throw new Error(`Failed to add question ${i + 1}`);
      }
    }
    
    console.log(`✅ Added ${questions.length} questions\n`);
    
    // Create session with 15 second timed mode
    console.log('⏱️  Creating session with 15 second answer time...');
    const createSessionRes = await fetch(`${BASE_URL}/api/quiz/${adminToken}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionName: 'Stress Test',
        useTimers: true,
        answerTimeSeconds: 15,
        scoreboardPauseSeconds: 5
      })
    });
    
    if (!createSessionRes.ok) {
      throw new Error('Failed to create session');
    }
    
    const session = await createSessionRes.json();
    console.log(`✅ Session created: ${session.joinCode}`);
    console.log(`   Session ID: ${session.sessionId}\n`);
    
    return { 
      sessionId: session.sessionId, 
      joinCode: session.joinCode,
      adminToken: adminToken
    };
  } catch (error) {
    console.error('❌ Quiz creation failed:', error.message);
    throw error;
  }
}

// Start the quiz session automatically
async function startQuizSession(sessionId, adminToken) {
  console.log('▶️  Starting quiz in auto-mode...');
  
  try {
    const res = await fetch(`${BASE_URL}/api/session/${sessionId}/start`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken
      },
      body: JSON.stringify({ autoMode: true })
    });
    
    if (!res.ok) {
      throw new Error('Failed to start session');
    }
    
    console.log('✅ Quiz started in auto-mode!\n');
  } catch (error) {
    console.error('❌ Failed to start quiz:', error.message);
    throw error;
  }
}

async function main() {
  let sessionId;
  let adminToken;
  
  if (AUTO_MODE) {
    // Create quiz and session automatically
    const quizData = await createTestQuiz();
    sessionId = quizData.sessionId;
    JOIN_CODE = quizData.joinCode;
    adminToken = quizData.adminToken;
  } else {
    // Validate existing join code
    console.log('📡 Validating join code...');
    
    try {
      const res = await fetch(`${BASE_URL}/api/join/${JOIN_CODE}`);
      if (!res.ok) {
        console.error('❌ Invalid join code or session not found');
        process.exit(1);
      }
      const data = await res.json();
      sessionId = data.sessionId;
      console.log(`✅ Session found: ${sessionId}\n`);
    } catch (error) {
      console.error('❌ Connection error:', error.message);
      process.exit(1);
    }
  }

  console.log('👥 Creating virtual players...');
  const players = [];
  
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    players.push(new VirtualPlayer(i, sessionId, BASE_URL));
  }

  console.log('📝 Registering players...');
  const registrationPromises = players.map(p => p.register());
  const registrationResults = await Promise.all(registrationPromises);
  
  const successfulRegistrations = registrationResults.filter(r => r).length;
  console.log(`✅ Registered: ${successfulRegistrations}/${NUM_PLAYERS}\n`);

  if (successfulRegistrations === 0) {
    console.error('❌ No players could register');
    process.exit(1);
  }

  console.log('🔌 Connecting players to session...');
  const connectionPromises = players
    .filter((_, i) => registrationResults[i])
    .map(p => p.connect());
  
  await Promise.all(connectionPromises);
  
  const connectedCount = players.filter(p => p.connected).length;
  console.log(`✅ Connected: ${connectedCount}/${successfulRegistrations}\n`);
  
  // Print viewing URLs
  console.log(`${'='.repeat(60)}`);
  console.log(`📺 VIEW THE QUIZ IN YOUR BROWSER:`);
  console.log(`${'='.repeat(60)}`);
  
  if (AUTO_MODE && adminToken) {
    // Extract public domain from BASE_URL
    const publicUrl = BASE_URL.replace('http://quiz:3042', 'https://quiz.zikkan.com')
                              .replace('http://nginx', 'https://quiz.zikkan.com')
                              .replace('http://localhost:3042', 'http://localhost');
    
    console.log(`\n🎮 Host View (control panel):`);
    console.log(`   ${publicUrl}/host/${sessionId}?token=${adminToken}`);
    
    console.log(`\n📺 Display View (presentation mode):`);
    console.log(`   ${publicUrl}/display/${sessionId}?token=${adminToken}`);
    
    console.log(`\n📱 Join as Player:`);
    console.log(`   ${publicUrl}/join`);
    console.log(`   Enter code: ${JOIN_CODE}`);
    
    console.log(`\n${'='.repeat(60)}\n`);
  }
  
  // Wait for manual start from GUI
  if (AUTO_MODE) {
    console.log('🎮 Players ready! Start the quiz manually from the Host View above.');
    console.log('⏱️  Answer time: 15 seconds');
    console.log('📊 Players will answer randomly between 0-15s (~10% will test timeout)\n');
  } else {
    console.log('🎮 Players ready! Waiting for questions...');
    console.log('💡 Players will automatically answer questions as they appear.\n');
  }

  // Keep script running
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    players.forEach(p => p.disconnect());
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
