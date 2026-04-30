import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import adminRoutes from './routes/admin.js';
import sessionRoutes from './routes/session.js';
import joinRoutes from './routes/join.js';
import registerSocketHandlers from './socket/handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

// Socket.io
const io = new Server(server, {
  cors: process.env.NODE_ENV === 'development' ? { origin: 'http://localhost:5173', credentials: true } : undefined
});
app.set('io', io);

// Trust proxy (for rate limiting behind nginx)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
const joinLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const answerLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.use('/api', generalLimiter);
app.use('/api/admin/login', loginLimiter);
app.use('/api/join', joinLimiter);
app.use('/api/answer', answerLimiter);

// API routes
app.use('/api', adminRoutes);
app.use('/api', sessionRoutes);
app.use('/api', joinRoutes);

// Serve uploads
app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

// Serve static client build
app.use(express.static(join(__dirname, 'public')));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Socket.io handlers
registerSocketHandlers(io);

// Start
const PORT = process.env.PORT || 3042;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`hexqz server running on port ${PORT}`);
});
