import { PanelLeft, Plus } from 'lucide-react';

export type ActiveView = 'workspace' | 'collections' | 'architecture';

interface HeaderProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  onOpenNewCollection: () => void;
  showSidebarToggle?: boolean;
  isMobileSidebarOpen?: boolean;
  onToggleMobileSidebar?: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveView; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'collections', label: 'Collections' },
  { id: 'architecture', label: 'Architecture' },
];

export function Header({
  activeView,
  onSelectView,
  onOpenNewCollection,
  showSidebarToggle = false,
  isMobileSidebarOpen = false,
  onToggleMobileSidebar,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:gap-6 sm:px-6 sm:py-3">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          {showSidebarToggle && onToggleMobileSidebar && (
            <button
              type="button"
              onClick={onToggleMobileSidebar}
              aria-expanded={isMobileSidebarOpen}
              aria-controls="workspace-sidebar-drawer"
              aria-label={isMobileSidebarOpen ? 'Close settings panel' : 'Open settings panel'}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 lg:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <PanelLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelectView('workspace')}
            className="inline-flex min-h-[44px] items-center text-left text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 sm:text-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
          >
            EduAssist
          </button>
        </div>

        <nav
          aria-label="Primary navigation"
          className="flex min-w-0 items-center gap-2 overflow-x-auto sm:gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-0.5 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 ${
                  isActive
                    ? 'border-blue-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenNewCollection}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <Plus className="h-4 w-4 sm:hidden" aria-hidden="true" />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New Collection</span>
          </button>
        </div>
      </div>
    </header>
  );
}
