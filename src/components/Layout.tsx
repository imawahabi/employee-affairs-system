import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header'; // Import the new Header
import SyncConflictsModal from './SyncConflictsModal';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, currentPage, onPageChange }) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);

  const isMobile = () => window.innerWidth < 768;

  const handleResize = () => {
    if (window.innerWidth < 768) {
      setIsSidebarCollapsed(true);
      setIsMobileNavOpen(false);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close mobile drawer on navigation
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [currentPage]);

  const toggleSidebar = () => {
    if (isMobile()) {
      setIsMobileNavOpen((v) => !v);
    } else {
      setIsSidebarCollapsed(!isSidebarCollapsed);
    }
  };

  const handleConflictResolved = () => {
    try {
      window.dispatchEvent(new CustomEvent(APP_SOFT_REFRESH_EVENT, { detail: { source: 'sync-conflict' } }));
    } catch {}
  };

  return (
    <div className="flex h-screen bg-gray-50" dir="rtl">
      {/* Mobile backdrop */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      <div className={isMobileNavOpen ? '' : ''}>
        <Sidebar
          isCollapsed={isMobile() ? false : isSidebarCollapsed}
          onToggle={toggleSidebar}
          currentPage={currentPage}
          onPageChange={onPageChange}
          mobileOpen={isMobileNavOpen}
        />
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${isMobile() ? 'mr-0' : isSidebarCollapsed ? 'mr-20' : 'mr-64'}`}>
        <Header
            onPageChange={onPageChange}
            onToggleSidebar={toggleSidebar}
            onOpenSyncConflicts={() => setConflictsOpen(true)}
        />

        {/* Page content */}
        <main id="app-scroll" className="flex-1 overflow-auto p-3 sm:p-5">
          {children}
        </main>
      </div>

      <SyncConflictsModal
        open={conflictsOpen}
        onClose={() => setConflictsOpen(false)}
        onResolved={handleConflictResolved}
      />
    </div>
  );
};

export default Layout;
