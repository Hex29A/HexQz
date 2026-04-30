import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingView from './views/LandingView.jsx';
import AdminDashboardView from './views/AdminDashboardView.jsx';
import AdminView from './views/AdminView.jsx';
import HostView from './views/HostView.jsx';
import JoinView from './views/JoinView.jsx';
import LobbyView from './views/LobbyView.jsx';
import GameView from './views/GameView.jsx';
import ResultsView from './views/ResultsView.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingView />} />
        <Route path="/admin" element={<AdminDashboardView />} />
        <Route path="/admin/:adminToken" element={<AdminView />} />
        <Route path="/host/:sessionId" element={<HostView />} />
        <Route path="/join" element={<JoinView />} />
        <Route path="/lobby/:sessionId" element={<LobbyView />} />
        <Route path="/game/:sessionId" element={<GameView />} />
        <Route path="/results/:sessionId" element={<ResultsView />} />
      </Routes>
    </BrowserRouter>
  );
}
