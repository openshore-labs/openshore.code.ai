import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.openshore.oscode',
  appName: 'OS Code',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0b1b2b',
  },
};

export default config;
