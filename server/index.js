import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import adminRoutes from './routes/admin.js';
import sessionRoutes from './routes/session.js';
import joinRoutes from './routes/join.js';
import registerSocketHandlers from './socket/handlers.js';

import './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: process.env.NODE_ENV === 'development' ? { origin: 'http://localhost:5173', credentials: true } : undefined
});
app.set('io', io);

app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

app.get('/api/version', (req, res) => {
  res.json({ hash: process.env.BUILD_HASH || 'dev' });
});

app.use('/api', adminRoutes);
app.use('/api', sessionRoutes);
app.use('/api', joinRoutes);

app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

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
