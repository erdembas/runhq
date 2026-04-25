import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { installScrollIdleTracker } from '@/lib/scrollIdle';
import { useAppStore } from '@/store/useAppStore';
import { getLatestRelease, getReleaseFor } from '@/lib/whatsnew';
import './styles.css';

installScrollIdleTracker();

// Dev-only QA hook: lets you trigger app store actions, open the
// "What's New" modal, or jump into the Release Notes archive from
// DevTools without reshipping a build.
//   __rhq.store.getState().openWhatsNew('0.6.0')
//   __rhq.whatsnew.openLatest()
//   __rhq.releaseNotes.open('0.6.0')
if (import.meta.env.DEV) {
  (window as unknown as { __rhq?: unknown }).__rhq = {
    store: useAppStore,
    whatsnew: {
      getLatestRelease,
      getReleaseFor,
      openLatest: () => {
        const release = getLatestRelease();
        if (!release) return null;
        useAppStore.getState().openWhatsNew(release.version);
        return release.version;
      },
      open: (version: string) => useAppStore.getState().openWhatsNew(version),
      close: () => useAppStore.getState().closeWhatsNew(),
    },
    releaseNotes: {
      open: (version?: string) => useAppStore.getState().openReleaseNotes(version),
      close: () => useAppStore.getState().closeReleaseNotes(),
    },
  };
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
