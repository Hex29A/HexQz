import { useEffect, useRef } from 'react';
import socket from '../socket.js';

// One socket lifecycle per view (issue #23 / #26):
// - `join()` runs once on mount and again on every reconnect, so the server
//   answers with a fresh `session:state` each time.
// - `handlers` is a map of event -> function. The latest functions are always
//   called (kept in a ref), and every listener this hook added is removed on
//   unmount, so nothing leaks into the next view.
export default function useSessionSocket({ enabled = true, join, handlers, deps = [] }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const joinRef = useRef(join);
  joinRef.current = join;

  useEffect(() => {
    if (!enabled) return undefined;
    const registered = [];
    for (const event of Object.keys(handlersRef.current)) {
      const fn = (...args) => handlersRef.current[event]?.(...args);
      socket.on(event, fn);
      registered.push([event, fn]);
    }
    const onConnect = () => joinRef.current?.();
    socket.on('connect', onConnect);

    socket.connect();
    if (socket.connected) joinRef.current?.();

    return () => {
      for (const [event, fn] of registered) socket.off(event, fn);
      socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

export { socket };
