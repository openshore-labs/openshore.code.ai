import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.openshore.oscode',
  appName: 'OpenShore',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#f6f4ef',
  },
  // Route fetch/XHR through native networking on iOS only (Electron/web are
  // untouched). Needed for Harbor's web search: DuckDuckGo's HTML endpoint
  // and the Brave/Tavily APIs are not CORS-enabled for an arbitrary app
  // origin, and native URLSession has no such restriction to begin with.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    // 'none' stops WKWebView from resizing or scrolling the page itself when
    // the keyboard opens. Without this, the webview drove its own native
    // scroll-to-reveal-the-focused-field behavior, which dragged the whole
    // page (header included) and even position: fixed elements along with
    // it, no matter how that was compensated for from the web layer. With
    // resize: 'none' the keyboard just overlays the bottom of an
    // otherwise-untouched page, and the composer's clearance above it is
    // driven directly by the keyboardWillShow/keyboardWillHide height (see
    // useKeyboardInset in ChatScreen.tsx) instead of guessed from
    // visualViewport.
    Keyboard: {
      resize: 'none',
    },
  },
};

export default config;
