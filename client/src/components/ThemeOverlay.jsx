import { useState, useEffect } from 'react';
import { onOverlayChange } from '../theme.js';

export default function ThemeOverlay() {
  const [overlayClass, setOverlayClass] = useState(null);

  useEffect(() => {
    onOverlayChange(setOverlayClass);
    return () => onOverlayChange(null);
  }, []);

  if (!overlayClass) return null;
  return <div className={`theme-overlay ${overlayClass}`} />;
}
