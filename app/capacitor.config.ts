import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.openshore.oscode',
  appName: 'OS Code',
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
  },
};

export default config;
