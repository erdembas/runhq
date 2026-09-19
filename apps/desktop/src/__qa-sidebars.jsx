import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { WorkspaceGroupHeader } from '@runhq/cockpit-ui';
import { ServiceRow } from './components/sidebar/ServiceRow';
import { StackRow } from './components/sidebar/StackRow';
import { CollapsedServiceList } from './components/sidebar/CollapsedServiceList';
import {
  SidebarAgentActivity,
  SidebarAgentActivityProvider,
} from './components/sidebar/SidebarAgentActivity';
import { AgentNavigation } from './components/agents/AgentNavigation';
import { useAgentStore } from './store/useAgentStore';
import { useAppStore } from './store/useAppStore';
const services = [
  {
    id: 'api',
    name: 'eledger-frontend',
    cwd: '/qa/api',
    tags: ['docker'],
    cmds: [{ name: 'dev', cmd: 'docker compose up' }],
    port: 5174,
  },
  {
    id: 'web',
    name: 'belgehub-backend',
    cwd: '/qa/web',
    tags: ['node'],
    cmds: [{ name: 'dev', cmd: 'pnpm dev' }],
    port: 3000,
  },
];
const sample = (id, project_id, status, extra = {}) => ({
  id,
  project_id,
  status,
  revision: 1,
  archived: false,
  unread: false,
  pending: [],
  updated_at: 1,
  ...extra,
});
useAppStore.setState({ services, editors: [], sections: [] });
useAgentStore.setState({
  ready: true,
  projects: [
    { id: 'p1', name: 'API', path: '/qa/api' },
    { id: 'p2', name: 'Web', path: '/qa/web' },
  ],
  sessions: {
    a: sample('a', 'p1', 'running'),
    b: sample('b', 'p1', 'running'),
    c: sample('c', 'p1', 'waiting_permission'),
    d: sample('d', 'p1', 'completed', { unread: true }),
    e: sample('e', 'p2', 'running'),
  },
});
const no = () => {};
function Row({ selected = false, index = 0 }) {
  return (
    <ServiceRow
      service={services[index]}
      status="stopped"
      selected={selected}
      currentSectionId={null}
      onSelect={no}
      onEdit={no}
      onDelete={no}
    />
  );
}
createRoot(document.getElementById('root')).render(
  <SidebarAgentActivityProvider>
    <main style={{ padding: 20 }}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>
        Actual sidebar components · 250 / 320 / 400 px
      </h1>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        {[250, 320, 400].map((width) => (
          <section
            key={width}
            style={{ width, flexShrink: 0, border: '1px solid #393633', paddingBottom: 20 }}
          >
            <h2 style={{ padding: 10 }}>{width}px</h2>
            <AgentNavigation expanded />
            <WorkspaceGroupHeader
              name="ETransformation-v2"
              count={5}
              collapsed={false}
              onToggle={no}
              activity={
                <SidebarAgentActivity serviceIds={['api', 'web']} name="ETransformation-v2" />
              }
            />
            <div style={{ padding: 8 }}>
              <Row />
              <Row index={1} />
              <p style={{ fontSize: 10, opacity: 0.5, marginTop: 16 }}>Selected row</p>
              <Row selected />
              <p style={{ fontSize: 10, opacity: 0.5, marginTop: 16 }}>Stack</p>
              <StackRow
                stackId="s"
                serviceIds={['api', 'web']}
                name="Project services stack"
                total={2}
                running={0}
                active={false}
                currentSectionId={null}
                onSelect={no}
                onStart={no}
                onStop={no}
                onEdit={no}
                onDelete={no}
              />
            </div>
          </section>
        ))}
      </div>
      <h2 style={{ marginTop: 20 }}>Collapsed rail</h2>
      <div style={{ width: 52, border: '1px solid #393633' }}>
        <AgentNavigation expanded={false} />
        <CollapsedServiceList
          services={services}
          statuses={{}}
          selectedServiceId={null}
          onSelect={no}
        />
      </div>
    </main>
  </SidebarAgentActivityProvider>,
);
