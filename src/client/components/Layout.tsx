import React, { useState } from 'react';
import {
  LayoutDashboard,
  Globe,
  Zap,
  Send,
  RefreshCw,
  AlertOctagon,
  RotateCcw,
  BarChart3,
  BookOpen,
  Settings,
  Radio,
  Search,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Webhook,
  CheckCircle2,
  WifiOff,
} from 'lucide-react';
import type { HealthResponse } from '../../shared/types';

export type NavSection =
  | 'overview'
  | 'endpoints'
  | 'events'
  | 'deliveries'
  | 'retry-queue'
  | 'dead-letters'
  | 'replay'
  | 'analytics'
  | 'receiver'
  | 'docs'
  | 'settings';

interface LayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  workspaceName: string;
  health: HealthResponse | null;
  healthError: boolean;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  onGlobalSearchSubmit: () => void;
  onSignOut: () => void;
  dlqCount: number;
  retryingCount: number;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'core' | 'queues' | 'developer';
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'core' },
  { id: 'endpoints', label: 'Endpoints', icon: Globe, group: 'core' },
  { id: 'events', label: 'Events', icon: Zap, group: 'core' },
  { id: 'deliveries', label: 'Deliveries', icon: Send, group: 'core' },
  { id: 'retry-queue', label: 'Retry Queue', icon: RefreshCw, group: 'queues' },
  { id: 'dead-letters', label: 'Dead Letter Queue', icon: AlertOctagon, group: 'queues' },
  { id: 'replay', label: 'Event Replay', icon: RotateCcw, group: 'queues' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'developer' },
  { id: 'receiver', label: 'Local Receiver', icon: Radio, group: 'developer' },
  { id: 'docs', label: 'API Documentation', icon: BookOpen, group: 'developer' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'developer' },
];

export function Layout({
  activeSection,
  onNavigate,
  workspaceName,
  health,
  healthError,
  globalSearch,
  onGlobalSearchChange,
  onGlobalSearchSubmit,
  onSignOut,
  dlqCount,
  retryingCount,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const handleSelectNav = (id: NavSection) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  const renderNavGroup = (group: 'core' | 'queues' | 'developer', heading: string) => {
    const items = NAV_ITEMS.filter((item) => item.group === group);
    return (
      <div className="mb-5">
        <div className="px-3 mb-1.5 text-[11px] font-medium text-[#646b7d]">{heading}</div>
        <div className="space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            const count =
              item.id === 'dead-letters'
                ? dlqCount
                : item.id === 'retry-queue'
                  ? retryingCount
                  : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium rounded-md transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#171b24] text-[#eef0f5]'
                    : 'text-[#8b92a5] hover:text-[#d8dce6] hover:bg-[#12151d]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-sky-400' : 'text-[#646b7d]'
                    }`}
                  />
                  <span className="truncate whitespace-nowrap">{item.label}</span>
                </span>
                {count > 0 && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      item.id === 'dead-letters' ? 'text-rose-400' : 'text-amber-400'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0d0f14] border-r border-[#1d2028]">
      <div className="h-14 px-4 flex items-center justify-between border-b border-[#1d2028] shrink-0">
        <button
          type="button"
          onClick={() => handleSelectNav('overview')}
          className="flex items-center gap-2.5 text-left cursor-pointer"
        >
          <div className="w-7 h-7 rounded-md bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Webhook className="w-4 h-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#eef0f5] whitespace-nowrap">
            HookRelay
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-[#8b92a5] hover:text-[#eef0f5]"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-4" aria-label="Main navigation">
        {renderNavGroup('core', 'Platform')}
        {renderNavGroup('queues', 'Reliability & Recovery')}
        {renderNavGroup('developer', 'Observability & Tools')}
      </nav>

      <div className="px-4 py-3 border-t border-[#1d2028] text-[11px] text-[#646b7d]">
        <div className="flex items-center justify-between">
          <span>SQLite Storage</span>
          <span className="font-mono text-[#9aa1b4]">
            {health?.database === 'connected' ? 'WAL Active' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-[#e8eaef] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-64 max-w-[82vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 sticky top-0 z-30 bg-[#0d0f14]/95 backdrop-blur-sm border-b border-[#1d2028] px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-1.5 text-[#8b92a5] hover:text-[#eef0f5] rounded hover:bg-[#171b24]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Workspace Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setWorkspaceMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-[#e8eaef] bg-[#13161e] hover:bg-[#191d28] border border-[#222633] rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <span className="truncate max-w-[140px]">{workspaceName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#7c8396]" />
              </button>
              {workspaceMenuOpen && (
                <div
                  className="absolute left-0 mt-1.5 w-56 bg-[#13161e] border border-[#242834] rounded-md shadow-xl py-1 z-40"
                  onMouseLeave={() => setWorkspaceMenuOpen(false)}
                >
                  <div className="px-3 py-1.5 text-[11px] text-[#646b7d]">Active Workspace</div>
                  <div className="px-3 py-1.5 text-xs font-medium text-[#eef0f5] flex items-center justify-between">
                    <span>{workspaceName}</span>
                    <span className="font-mono text-[10px] text-sky-400">default</span>
                  </div>
                  <div className="border-t border-[#1d2028] my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      onNavigate('settings');
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[#9aa1b4] hover:text-[#eef0f5] hover:bg-[#1b1f2a] cursor-pointer"
                  >
                    Rename workspace in Settings
                  </button>
                </div>
              )}
            </div>

            <span className="hidden sm:inline text-[#2b303f]">/</span>

            {/* Environment Indicator & Live Backend Connection Status */}
            <div className="hidden md:flex items-center gap-3 text-xs">
              <span className="font-mono text-[#9aa1b4] whitespace-nowrap">
                {health?.environment || 'development'}
              </span>
              <span className="text-[#2b303f]">·</span>
              {healthError || !health ? (
                <span className="inline-flex items-center gap-1.5 text-rose-400 whitespace-nowrap">
                  <WifiOff className="w-3.5 h-3.5" />
                  Backend Disconnected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 whitespace-nowrap">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected
                  {health.worker.running ? (
                    <span className="text-[#7c8396] font-mono">
                      · Worker Active
                    </span>
                  ) : null}
                </span>
              )}
            </div>
          </div>

          {/* Search & Profile Menu */}
          <div className="flex items-center gap-3 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onGlobalSearchSubmit();
              }}
              className="hidden sm:flex items-center relative"
            >
              <Search className="w-3.5 h-3.5 text-[#646b7d] absolute left-2.5 pointer-events-none" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => onGlobalSearchChange(e.target.value)}
                placeholder="Search IDs, events, endpoints..."
                className="w-52 xl:w-64 pl-8 pr-3 py-1.5 text-xs bg-[#0a0b0e] border border-[#222633] rounded-md text-[#e8eaef] placeholder-[#5c6375] focus:outline-none focus:border-sky-500 transition-colors"
              />
            </form>

            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-[#c8cddc] hover:text-[#eef0f5] bg-[#13161e] hover:bg-[#191d28] border border-[#222633] rounded-md transition-colors cursor-pointer whitespace-nowrap"
              >
                <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-300 font-mono text-[11px] font-semibold flex items-center justify-center">
                  AD
                </span>
                <span className="hidden sm:inline">Admin</span>
              </button>

              {profileMenuOpen && (
                <div
                  className="absolute right-0 mt-1.5 w-48 bg-[#13161e] border border-[#242834] rounded-md shadow-xl py-1 z-40"
                  onMouseLeave={() => setProfileMenuOpen(false)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onNavigate('receiver');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#c8cddc] hover:bg-[#1b1f2a] cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5 text-[#8b92a5]" />
                    Local Test Receiver
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onNavigate('settings');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#c8cddc] hover:bg-[#1b1f2a] cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-[#8b92a5]" />
                    Platform Settings
                  </button>
                  <div className="border-t border-[#1d2028] my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onSignOut();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-[#1b1f2a] cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Lock Session
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
