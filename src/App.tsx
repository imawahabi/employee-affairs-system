import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import EmployeeManagement from './components/EmployeeManagement';
import ShiftRegistration from './components/ShiftRegistration';
import ViewShifts from './components/ViewShifts';
import Reports from './components/Reports';
import EmployeeReportsBuilder from './components/EmployeeReportsBuilder';
import EmployeeShiftHistory from './components/EmployeeShiftHistory';
import Alerts from './components/Alerts';
import Settings from './components/Settings';
import NextDutyQueue from './components/NextDutyQueue';
import ProfessionalExtensions from './components/ProfessionalExtensions';
import AuditLog from './components/AuditLog';
import ParkingMap from './components/ParkingMap';
import LicenseAdd from './licenses/components/AddLicense';
import LicenseList from './licenses/components/LicenseList';
import LicenseReports from './licenses/components/Reports';
import LicenseReportsNew from './licenses/components/ModernReports';
import { SystemProvider, useSystem } from './contexts/SystemContext';

const PAGE_IDS = new Set([
  'dashboard',
  'employees',
  'parking-map',
  'shifts',
  'view-shifts',
  'employee-shift-history',
  'reports',
  'employee-reports',
  'alerts',
  'professional-extensions',
  'settings',
  'settings-departments',
  'settings-ranks',
  'settings-nationalities',
  'settings-job-titles',
  'next-queue',
  'audit-log',
  'licenses-add',
  'licenses-list',
  'licenses-report-new',
  'licenses-reports',
]);

const SHIFT_PAGES = new Set([
  'shifts',
  'view-shifts',
  'employee-shift-history',
  'reports',
  'next-queue',
]);

const LICENSE_PAGES = new Set([
  'licenses-add',
  'licenses-list',
  'licenses-report-new',
  'licenses-reports',
]);

const normalizePage = (value?: string | null) => {
  if (!value) return 'dashboard';
  return PAGE_IDS.has(value) ? value : 'dashboard';
};

const getPageFromLocation = () => {
  const hash = window.location.hash.replace('#', '').trim();
  if (hash) return hash;

  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get('page');
  if (pageParam) return pageParam.trim();

  const parts = window.location.pathname.split('/').filter(Boolean);
  const lastSegment = parts[parts.length - 1];
  if (!lastSegment || lastSegment === 'index.html' || lastSegment.includes('.')) {
    return '';
  }
  return lastSegment;
};

function AppContent() {
  const { hideShifts, hideLicenses } = useSystem();
  const [currentPage, setCurrentPage] = useState('dashboard');

  useEffect(() => {
    try {
      localStorage.removeItem('currentPage');
    } catch {}
    if (window.location.hash !== '#dashboard') {
      window.history.replaceState(null, '', '#dashboard');
    }
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const fromLocation = getPageFromLocation();
      if (!fromLocation) return;
      setCurrentPage(normalizePage(fromLocation));
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const handlePageChange = useCallback((page: string) => {
    const normalized = normalizePage(page);
    const isShiftBlocked = hideShifts && SHIFT_PAGES.has(normalized);
    const isLicenseBlocked = hideLicenses && LICENSE_PAGES.has(normalized);
    const nextPage = isShiftBlocked || isLicenseBlocked ? 'dashboard' : normalized;
    setCurrentPage(nextPage);
    try {
      localStorage.setItem('currentPage', nextPage);
    } catch {}
    if (window.location.hash !== `#${nextPage}`) {
      window.history.replaceState(null, '', `#${nextPage}`);
    }
  }, [hideShifts, hideLicenses]);

  useEffect(() => {
    if ((hideShifts && SHIFT_PAGES.has(currentPage)) || (hideLicenses && LICENSE_PAGES.has(currentPage))) {
      handlePageChange('dashboard');
    }
  }, [hideShifts, hideLicenses, currentPage, handlePageChange]);

  const renderPage = () => {
    if ((hideShifts && SHIFT_PAGES.has(currentPage)) || (hideLicenses && LICENSE_PAGES.has(currentPage))) {
      return <Dashboard onPageChange={handlePageChange} />;
    }
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onPageChange={handlePageChange} />;
      case 'employees':
        return <EmployeeManagement />;
      case 'parking-map':
        return <ParkingMap />;
      case 'shifts':
        return <ShiftRegistration />;
      case 'view-shifts':
        return <ViewShifts />;
      case 'employee-shift-history':
        return <EmployeeShiftHistory />;
      case 'reports':
        return <Reports />;
      case 'employee-reports':
        return <EmployeeReportsBuilder />;
      case 'alerts':
        return <Alerts />;
      case 'professional-extensions':
        return <ProfessionalExtensions />;
      case 'settings':
        return <Settings mode="general" />;
      case 'settings-departments':
        return <Settings mode="departments" />;
      case 'settings-ranks':
        return <Settings mode="ranks" />;
      case 'settings-nationalities':
        return <Settings mode="nationalities" />;
      case 'settings-job-titles':
        return <Settings mode="job-titles" />;
      case 'next-queue':
        return <NextDutyQueue />;
      case 'audit-log':
        return <AuditLog />;
      case 'licenses-add':
        return <div className="licenses-module licenses-print"><LicenseAdd onNavigate={handlePageChange} /></div>;
      case 'licenses-list':
        return <div className="licenses-module licenses-print"><LicenseList /></div>;
      case 'licenses-report-new':
        return <div className="licenses-module licenses-print"><LicenseReportsNew onNavigate={handlePageChange} /></div>;
      case 'licenses-reports':
        return <div className="licenses-module licenses-print"><LicenseReports /></div>;
      default:
        return <Dashboard onPageChange={handlePageChange} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Layout currentPage={currentPage} onPageChange={handlePageChange}>
        {renderPage()}
      </Layout>
      <Toaster />
    </div>
  );
}

function App() {
  return (
    <SystemProvider>
      <AppContent />
    </SystemProvider>
  );
}

export default App;
