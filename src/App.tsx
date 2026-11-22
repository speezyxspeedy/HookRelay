import { useCallback, useEffect, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from './client/services/api';
import type { AuthStatus, HealthResponse, RetrySettings } from './shared/types';
import { AuthGate } from './client/components/AuthGate';
import { Layout, type NavSection } from './client/components/Layout';
import { OverviewPage } from './client/pages/OverviewPage';
import { EndpointsPage } from './client/pages/EndpointsPage';
import { EventsPage } from './client/pages/EventsPage';
import { DeliveriesPage } from './client/pages/DeliveriesPage';
import { DeliveryInspectorPage } from './client/pages/DeliveryInspectorPage';
import { RetryQueuePage } from './client/pages/RetryQueuePage';
import { DeadLetterQueuePage } from './client/pages/DeadLetterQueuePage';
import { EventReplayPage } from './client/pages/EventReplayPage';
import { AnalyticsPage } from './client/pages/AnalyticsPage';
import { ReceiverPage } from './client/pages/ReceiverPage';
import { ApiDocsPage } from './client/pages/ApiDocsPage';
import { SettingsPage } from './client/pages/SettingsPage';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [inspectedDeliveryId, setInspectedDeliveryId] = useState<string | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [replayEventId, setReplayEventId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('Production Core');
  const [dlqCount, setDlqCount] = useState(0);
  const [retryingCount, setRetryingCount] = useState(0);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
      setAuthenticated(status.authenticated);
    } catch {
      setAuthenticated(false);
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthenticated(false);
      void checkAuth();
    });
    void checkAuth();
    return () => setUnauthorizedHandler(null);
  }, [checkAuth]);

  const pollHealthAndCounts = useCallback(async () => {
    try {
      const h = await api.getHealth();
      setHealth(h);
      setHealthError(false);
    } catch {
      setHealthError(true);
    }

    if (!authenticated) return;
    try {
      const [overview, settings] = await Promise.all([
        api.getOverview(),
        api.getSettings(),
      ]);
      setDlqCount(overview.metrics.dead_letter_count);
      setRetryingCount(overview.metrics.pending_retries);
      setWorkspaceName(settings.workspace_name);
    } catch {
      // Ignore transient poll errors
    }
  }, [authenticated]);

  useEffect(() => {
    void pollHealthAndCounts();
    const timer = setInterval(() => void pollHealthAndCounts(), 5000);
    return () => clearInterval(timer);
  }, [pollHealthAndCounts]);

  const handleNavigate = (section: NavSection) => {
    setActiveSection(section);
    setInspectedDeliveryId(null);
    if (section !== 'endpoints') {
      setSelectedEndpointId(null);
    }
  };

  const handleInspectDelivery = (deliveryId: string) => {
    setActiveSection('deliveries');
    setInspectedDeliveryId(deliveryId);
  };

  const handleInspectEndpoint = (endpointId: string) => {
    setActiveSection('endpoints');
    setSelectedEndpointId(endpointId);
    setInspectedDeliveryId(null);
  };

  const handleJumpToReplay = (eventId: string) => {
    setReplayEventId(eventId);
    setActiveSection('replay');
    setInspectedDeliveryId(null);
  };

  const handleGlobalSearchSubmit = () => {
    const q = globalSearch.trim();
    if (!q) return;
    setInspectedDeliveryId(null);
    if (q.startsWith('del_')) {
      handleInspectDelivery(q);
    } else if (q.startsWith('ep_')) {
      handleInspectEndpoint(q);
    } else if (q.startsWith('evt_')) {
      setActiveSection('events');
    } else if (
      activeSection !== 'deliveries' &&
      activeSection !== 'events' &&
      activeSection !== 'endpoints'
    ) {
      setActiveSection('deliveries');
    }
  };

  const handleSignOut = () => {
    setAuthToken(null);
    setAuthenticated(false);
    void checkAuth();
  };

  const handleSettingsUpdated = (settings: RetrySettings) => {
    setWorkspaceName(settings.workspace_name);
    void pollHealthAndCounts();
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0a0b0e] text-[#8b92a5] flex items-center justify-center text-xs font-mono">
        Connecting to HookRelay backend...
      </div>
    );
  }

  if (!authenticated && authStatus) {
    return (
      <AuthGate
        authStatus={authStatus}
        onAuthenticated={() => {
          setAuthenticated(true);
          void pollHealthAndCounts();
        }}
      />
    );
  }

  return (
    <Layout
      activeSection={activeSection}
      onNavigate={handleNavigate}
      workspaceName={workspaceName}
      health={health}
      healthError={healthError}
      globalSearch={globalSearch}
      onGlobalSearchChange={setGlobalSearch}
      onGlobalSearchSubmit={handleGlobalSearchSubmit}
      onSignOut={handleSignOut}
      dlqCount={dlqCount}
      retryingCount={retryingCount}
    >
      {inspectedDeliveryId ? (
        <DeliveryInspectorPage
          deliveryId={inspectedDeliveryId}
          onBack={() => setInspectedDeliveryId(null)}
          onInspectDelivery={handleInspectDelivery}
        />
      ) : activeSection === 'overview' ? (
        <OverviewPage
          onNavigate={handleNavigate}
          onInspectDelivery={handleInspectDelivery}
          onInspectEndpoint={handleInspectEndpoint}
        />
      ) : activeSection === 'endpoints' ? (
        <EndpointsPage
          selectedEndpointId={selectedEndpointId}
          onSelectEndpoint={setSelectedEndpointId}
          onInspectDelivery={handleInspectDelivery}
          searchQuery={globalSearch}
        />
      ) : activeSection === 'events' ? (
        <EventsPage
          onInspectDelivery={handleInspectDelivery}
          onJumpToReplay={handleJumpToReplay}
          searchQuery={globalSearch}
        />
      ) : activeSection === 'deliveries' ? (
        <DeliveriesPage
          onInspectDelivery={handleInspectDelivery}
          searchQuery={globalSearch}
        />
      ) : activeSection === 'retry-queue' ? (
        <RetryQueuePage onInspectDelivery={handleInspectDelivery} />
      ) : activeSection === 'dead-letters' ? (
        <DeadLetterQueuePage onInspectDelivery={handleInspectDelivery} />
      ) : activeSection === 'replay' ? (
        <EventReplayPage
          initialEventId={replayEventId}
          onInspectDelivery={handleInspectDelivery}
        />
      ) : activeSection === 'analytics' ? (
        <AnalyticsPage />
      ) : activeSection === 'receiver' ? (
        <ReceiverPage />
      ) : activeSection === 'docs' ? (
        <ApiDocsPage />
      ) : (
        <SettingsPage onSettingsUpdated={handleSettingsUpdated} />
      )}
    </Layout>
  );
}
