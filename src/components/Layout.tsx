import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header'; // Import the new Header

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, currentPage, onPageChange }) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleResize = () => {
    if (window.innerWidth < 768) {
      setIsSidebarCollapsed(true);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="flex h-screen bg-gray-50" dir="rtl">
      <Sidebar 
        isCollapsed={isSidebarCollapsed}
        onToggle={toggleSidebar}
        currentPage={currentPage}
        onPageChange={onPageChange}
      />

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${isSidebarCollapsed ? 'mr-20' : 'mr-64'}`}>
        <Header 
            onPageChange={onPageChange} 
            onToggleSidebar={toggleSidebar} 
        />

        {/* Page content */}
        <main id="app-scroll" className="flex-1 overflow-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
