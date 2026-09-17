import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import adminRoutes, { uploadsDir } from './routes/admin.js';
import sessionRoutes from './routes/session.js';
import joinRoutes from './routes/join.js';
import registerSocketHandlers from './socket/handlers.js';
import { validationErrorHandler } from './validate.js';

import seedDemoQuiz from './seed.js';

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SECRET) {
  console.error('ADMIN_SECRET is required in production (quiz creation and uploads would be open to anyone)');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: process.env.NODE_ENV === 'development' ? { origin: 'http://localhost:5173', credentials: true } : undefined
});
app.set('io', io);

app.set('trust proxy', 1);

// Security headers (issue #14). HSTS only on TLS requests (req.secure honours
// X-Forwarded-Proto because of trust proxy). Referrer-Policy keeps admin tokens
// in URLs out of third-party referrers.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

seedDemoQuiz();

app.get('/api/version', (req, res) => {
  res.json({ hash: process.env.BUILD_HASH || 'dev' });
});

app.use('/api', adminRoutes);
app.use('/api', sessionRoutes);
app.use('/api', joinRoutes);
app.use(validationErrorHandler);

app.use('/uploads', express.static(uploadsDir));

app.use(express.static(join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

registerSocketHandlers(io);

const PORT = process.env.PORT || 3042;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`hexqz server running on port ${PORT}`);
});
