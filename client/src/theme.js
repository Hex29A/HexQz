const THEME_IDS = ['indigo', 'emerald', 'rose', 'amber', 'cyan', 'violet', 'synthwave', 'startrek', 'sunset', 'slate'];

const OVERLAY_THEMES = {
  synthwave: 'theme-overlay-synthwave',
  startrek: 'theme-overlay-startrek',
};

let overlayCallback = null;

export function onOverlayChange(cb) {
  overlayCallback = cb;
}

export function applyTheme(themeColor, lightMode = false) {
  if (!themeColor) return;

  // Set mode
  if (lightMode) {
    document.documentElement.setAttribute('data-mode', 'light');
  } else {
    document.documentElement.removeAttribute('data-mode');
  }

  if (THEME_IDS.includes(themeColor)) {
    document.documentElement.setAttribute('data-theme', themeColor);
    // No overlay in light mode
    if (overlayCallback) {
      overlayCallback(lightMode ? null : (OVERLAY_THEMES[themeColor] || null));
    }
  } else if (themeColor.startsWith('#')) {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.setProperty('--accent', themeColor);
    if (overlayCallback) overlayCallback(null);
  }
}
