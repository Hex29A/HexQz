// Admin tokens for host/display/results pages are kept in localStorage
// instead of the URL (issue #4), so they stay out of history, projector
// screens and server logs. Old ?token= links still work once: the token is
// stored and stripped from the address bar.
const key = (sessionId) => `hexqz.adminToken.${sessionId}`;

export function rememberAdminToken(sessionId, token) {
  if (sessionId && token) localStorage.setItem(key(sessionId), token);
}

export function getAdminToken(sessionId) {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    rememberAdminToken(sessionId, fromUrl);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    return fromUrl;
  }
  return localStorage.getItem(key(sessionId));
}
