import { useCallback, useEffect, useState } from 'react';
import type {
  AcademicTrack,
  InstitutionCollection,
  InstitutionType,
  KnowledgeSourceMode,
  SystemHealthResponse,
} from '../shared/types/knowledge.ts';
import { ArchitectureOverview } from './components/ArchitectureOverview.tsx';
import { AssistantWorkspace } from './components/AssistantWorkspace.tsx';
import { CollectionDocumentsView } from './components/CollectionDocumentsView.tsx';
import { CollectionsManager } from './components/CollectionsManager.tsx';
import { type ActiveView, Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import {
  createCollection,
  fetchCollections,
  fetchSystemHealth,
} from './services/apiClient.ts';

function getInitialUrlState(): {
  view: ActiveView;
  managedCollectionId: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const collectionParam = params.get('collection');

  if (viewParam === 'documents' && collectionParam) {
    return { view: 'collections', managedCollectionId: collectionParam };
  }
  if (viewParam === 'collections' || viewParam === 'architecture') {
    return { view: viewParam, managedCollectionId: null };
  }
  return { view: 'workspace', managedCollectionId: null };
}

export default function App() {
  const initialUrlState = getInitialUrlState();
  const [activeView, setActiveView] = useState<ActiveView>(initialUrlState.view);
  const [academicTrack, setAcademicTrack] = useState<AcademicTrack>('classes_11_12');
  const [knowledgeMode, setKnowledgeMode] =
    useState<KnowledgeSourceMode>('dual');

  const [collections, setCollections] = useState<InstitutionCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [managedCollectionId, setManagedCollectionId] = useState<string | null>(
    initialUrlState.managedCollectionId,
  );
  const [showCreateCollectionForm, setShowCreateCollectionForm] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeView === 'collections' && managedCollectionId) {
      params.set('view', 'documents');
      params.set('collection', managedCollectionId);
    } else if (activeView !== 'workspace') {
      params.set('view', activeView);
    }
    const queryString = params.toString();
    const nextUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }, [activeView, managedCollectionId]);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const items = await fetchCollections();
      setCollections(items);
      if (items.length > 0) {
        setSelectedCollectionId((prev) => prev ?? items[0].id);
      }
    } catch {
      // Collections list remains empty if backend is unreachable
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await fetchSystemHealth();
      setHealth(data);
    } catch (error) {
      setHealthError(
        error instanceof Error ? error.message : 'Unable to fetch system health.',
      );
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
    void loadHealth();
  }, [loadCollections, loadHealth]);

  const handleSelectView = (view: ActiveView) => {
    setActiveView(view);
    setManagedCollectionId(null);
    setIsMobileSidebarOpen(false);
  };

  const handleOpenNewCollection = () => {
    setManagedCollectionId(null);
    setActiveView('collections');
    setShowCreateCollectionForm(true);
    setIsMobileSidebarOpen(false);
  };

  const handleCreateCollection = async (input: {
    name: string;
    institutionType: InstitutionType;
    academicTrack: AcademicTrack;
    description: string;
  }) => {
    const created = await createCollection(input);
    setCollections((prev) => [created, ...prev]);
    setSelectedCollectionId(created.id);
    setAcademicTrack(created.academicTrack);
  };

  const handleCollectionUpdated = useCallback((updated: InstitutionCollection) => {
    setCollections((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  const selectedCollection =
    collections.find((item) => item.id === selectedCollectionId) ?? null;

  const managedCollection =
    collections.find((item) => item.id === managedCollectionId) ?? null;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-slate-50 text-slate-900">
      <Header
        activeView={activeView}
        onSelectView={handleSelectView}
        onOpenNewCollection={handleOpenNewCollection}
        showSidebarToggle={activeView === 'workspace'}
        isMobileSidebarOpen={isMobileSidebarOpen}
        onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        {activeView === 'workspace' && (
          <Sidebar
            academicTrack={academicTrack}
            onChangeTrack={setAcademicTrack}
            knowledgeMode={knowledgeMode}
            onChangeKnowledgeMode={setKnowledgeMode}
            collections={collections}
            selectedCollectionId={selectedCollectionId}
            onSelectCollection={setSelectedCollectionId}
            onCreateCollectionClick={handleOpenNewCollection}
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1">
          {activeView === 'workspace' && (
            <AssistantWorkspace
              academicTrack={academicTrack}
              knowledgeMode={knowledgeMode}
              selectedCollection={selectedCollection}
              onOpenCollections={() => handleSelectView('collections')}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            />
          )}

          {activeView === 'collections' &&
            (managedCollection ? (
              <CollectionDocumentsView
                collection={managedCollection}
                onBackToCollections={() => setManagedCollectionId(null)}
                onCollectionUpdated={handleCollectionUpdated}
              />
            ) : managedCollectionId && collectionsLoading ? (
              <div className="mx-auto max-w-5xl p-8 text-sm text-slate-500">
                Loading collection...
              </div>
            ) : (
              <CollectionsManager
                collections={collections}
                isLoading={collectionsLoading}
                selectedCollectionId={selectedCollectionId}
                onSelectCollection={(id) => {
                  setSelectedCollectionId(id);
                  setActiveView('workspace');
                }}
                onManageDocuments={(id) => {
                  setSelectedCollectionId(id);
                  setManagedCollectionId(id);
                }}
                onCreateCollection={handleCreateCollection}
                showCreateForm={showCreateCollectionForm}
                onToggleCreateForm={setShowCreateCollectionForm}
              />
            ))}

          {activeView === 'architecture' && (
            <ArchitectureOverview
              health={health}
              isLoading={healthLoading}
              error={healthError}
              onRefresh={loadHealth}
            />
          )}
        </main>
      </div>
    </div>
  );
}
