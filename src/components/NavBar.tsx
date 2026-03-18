'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueueContext } from '@/contexts/QueueProcessorContext';
import { useExerciseLibrary } from '@/hooks/useExerciseLibrary';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import { useBatchSubmission } from '@/contexts/BatchSubmissionContext';
import PositionManagementModal from './PositionManagementModal';
import EquipmentManagementModal from './EquipmentManagementModal';
import ImportTemplatesModal from './ImportTemplatesModal';
import BatchImportVideosModal from './BatchImportVideosModal';
import BatchProgressPanel from './BatchProgressPanel';
import ActiveTasksIndicator from './ActiveTasksIndicator';
import type { ExerciseTemplate } from '@/types';

export default function NavBar() {
  const pathname = usePathname();
  const { items: submissionItems, isSubmitting } = useBatchSubmission();
  const { isProcessing } = useQueueContext();
  const { exercises } = useExerciseLibrary();
  const { templates, addTemplate, updateTemplate } = useExerciseTemplates();
  const { positions, createPosition, updatePosition, deletePosition } = usePositions();
  const { equipment, addEquipment, updateEquipment, deleteEquipment, allEquipmentNames } = useEquipment();

  const [collapsed, setCollapsed] = useState(false);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);

  // Persist collapsed state
  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === 'true') setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const handleImportTemplates = useCallback(async (imported: Omit<ExerciseTemplate, 'id' | 'createdAt'>[]) => {
    for (const t of imported) {
      try { await addTemplate(t); } catch (err) { console.error(`Failed to import ${t.exerciseName}:`, err); }
    }
    window.location.href = '/';
  }, [addTemplate]);

  const pendingCount = templates.length;
  const isActive = (path: string) => pathname === path;

  const navLink = (href: string, label: string, icon: React.ReactNode, badge?: number) => (
    <Link
      href={href}
      className={`relative flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive(href) ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
          {badge}
        </span>
      )}
      {collapsed && badge != null && badge > 0 && (
        <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-amber-400 text-white text-[9px] font-bold">
          {badge}
        </span>
      )}
    </Link>
  );

  const navButton = (onClick: () => void, label: string, icon: React.ReactNode) => (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
    </button>
  );

  const sectionLabel = (label: string) => !collapsed && (
    <p className="px-2.5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
  );

  return (
    <>
      <aside className={`flex flex-col h-screen bg-white border-r border-gray-200 flex-shrink-0 transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}>

        {/* Header */}
        <div className={`flex items-center h-14 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'px-3 gap-2'}`}>
          {!collapsed && (
            <span className="flex-1 text-sm font-bold text-gray-900 truncate">Avatar Transformer</span>
          )}
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              }
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">

          {/* Dashboard */}
          {navLink('/', 'Home',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>,
            pendingCount
          )}


          {sectionLabel('Manage')}

          {/* Positions */}
          {navButton(() => setShowPositionModal(true), 'Positions',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}

          {/* Equipment */}
          {navButton(() => setShowEquipmentModal(true), 'Equipment',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          )}

          {sectionLabel('Tools')}

          {/* Image Gen — always expanded tree */}
          <div>
            <div className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium ${
              pathname.startsWith('/image-gen') ? 'text-blue-700' : 'text-gray-600'
            }`}>
              <span className="flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </span>
              {!collapsed && <span className="flex-1">Image Gen</span>}
            </div>
            {!collapsed && (
              <div className="ml-8 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">
                <Link href="/image-gen" className="block px-2 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                  Generate
                </Link>
                <Link href="/image-gen?tab=edit" className="block px-2 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                  Edit
                </Link>
                <Link href="/image-gen?tab=canva" className="block px-2 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                  Canva
                </Link>
              </div>
            )}
          </div>

          {/* Loop */}
          {navLink('/loop', 'Loop Finder',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}

          {/* Tools */}
          {navLink('/tools', 'Tools',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}

          {sectionLabel('Import')}

          {/* Import Templates */}
          {navButton(() => setShowImportModal(true), 'Import Templates',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}

          {/* Batch Videos */}
          {navButton(() => setShowBatchImportModal(true), 'Batch Videos',
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}

        </nav>
      </aside>

      {/* Modals */}
      <PositionManagementModal
        isOpen={showPositionModal}
        onClose={() => setShowPositionModal(false)}
        positions={positions}
        equipmentOptions={allEquipmentNames}
        onCreatePosition={createPosition}
        onUpdatePosition={updatePosition}
        onDeletePosition={deletePosition}
      />
      <EquipmentManagementModal
        isOpen={showEquipmentModal}
        onClose={() => setShowEquipmentModal(false)}
        equipment={equipment}
        onAddEquipment={addEquipment}
        onUpdateEquipment={updateEquipment}
        onDeleteEquipment={deleteEquipment}
      />
      <ImportTemplatesModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportTemplates}
        positions={positions}
        equipmentNames={allEquipmentNames}
        createPosition={createPosition}
        templates={templates}
        onUpdateTemplate={updateTemplate}
      />
      <BatchImportVideosModal
        isOpen={showBatchImportModal}
        onClose={() => setShowBatchImportModal(false)}
        templates={templates}
        positions={positions}
        onUpdateTemplate={updateTemplate}
        onAddTemplate={addTemplate}
        onCreatePosition={createPosition}
      />
      <BatchProgressPanel />
      <ActiveTasksIndicator />
    </>
  );
}
