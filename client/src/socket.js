import { io } from 'socket.io-client';

const URL = import.meta.env.DEV ? 'http://localhost:3042' : undefined;

const socket = io(URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  reconnectionAttempts: Infinity
});

export default socket;
