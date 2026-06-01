import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingView from './views/LandingView.jsx';
import AdminDashboardView from './views/AdminDashboardView.jsx';
import AdminView from './views/AdminView.jsx';
import HostView from './views/HostView.jsx';
import JoinView from './views/JoinView.jsx';
import LobbyView from './views/LobbyView.jsx';
import GameView from './views/GameView.jsx';
import ResultsView from './views/ResultsView.jsx';
import DisplayView from './views/DisplayView.jsx';
import ThemeOverlay from './components/ThemeOverlay.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeOverlay />
      <Routes>
        <Route path="/" element={<div className="flex items-center justify-center min-h-screen"><div className="text-gray-600">404</div></div>} />
        <Route path="/admin" element={<AdminDashboardView />} />
        <Route path="/admin/:adminToken" element={<AdminView />} />
        <Route path="/host/:sessionId" element={<HostView />} />
        <Route path="/display/:sessionId" element={<DisplayView />} />
        <Route path="/join" element={<JoinView />} />
        <Route path="/lobby/:sessionId" element={<LobbyView />} />
        <Route path="/game/:sessionId" element={<GameView />} />
        <Route path="/results/:sessionId" element={<ResultsView />} />
      </Routes>
    </BrowserRouter>
  );
}
