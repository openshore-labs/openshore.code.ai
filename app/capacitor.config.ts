import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.openshore.oscode',
  appName: 'OS Code',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#f6f4ef',
  },
};

export default config;
