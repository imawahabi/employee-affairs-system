import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { fetchSettings } from '../api';

interface SystemContextType {
  systemName: string;
  departmentName: string;
  companyName: string;
  hideShifts: boolean;
  hideLicenses: boolean;
  hideParking: boolean;
  hideProfessionalExtensions: boolean;
  excludeWeekendShifts: boolean;
  restrictToDepartment: boolean;
  restrictedDepartmentName: string;
  updateSystemName: (name: string) => void;
  updateDepartmentName: (name: string) => void;
  updateCompanyName: (name: string) => void;
  updateHideShifts: (hidden: boolean) => void;
  updateHideLicenses: (hidden: boolean) => void;
  updateHideParking: (hidden: boolean) => void;
  updateHideProfessionalExtensions: (hidden: boolean) => void;
  updateExcludeWeekendShifts: (enabled: boolean) => void;
  updateRestrictToDepartment: (enabled: boolean) => void;
  updateRestrictedDepartmentName: (name: string) => void;
}

const SystemContext = createContext<SystemContextType | undefined>(undefined);

interface SystemProviderProps {
  children: ReactNode;
}

export const SystemProvider: React.FC<SystemProviderProps> = ({ children }) => {
  const [systemName, setSystemName] = useState('نظام  شؤون الموظفين');
  const [departmentName, setDepartmentName] = useState('إدارة الشؤون الإدارية');
  const [companyName, setCompanyName] = useState('الجهة الحكومية');
  const [hideShifts, setHideShifts] = useState(false);
  const [hideLicenses, setHideLicenses] = useState(false);
  const [hideParking, setHideParking] = useState(false);
  const [hideProfessionalExtensions, setHideProfessionalExtensions] = useState(false);
  const [excludeWeekendShifts, setExcludeWeekendShifts] = useState(true);
  const [restrictToDepartment, setRestrictToDepartment] = useState(false);
  const [restrictedDepartmentName, setRestrictedDepartmentName] = useState('');

  // Load system settings on mount
  useEffect(() => {
    const loadSystemSettings = async () => {
      try {
        const settings = await fetchSettings();
        if (settings.system_name?.value) {
          setSystemName(settings.system_name.value);
        }
        if (settings.department_name?.value) {
          setDepartmentName(settings.department_name.value);
        }
        if (settings.company_name?.value) {
          setCompanyName(settings.company_name.value);
        }
        if (settings.hide_shifts?.value) {
          setHideShifts(settings.hide_shifts.value === 'true');
        }
        if (settings.hide_licenses?.value) {
          setHideLicenses(settings.hide_licenses.value === 'true');
        }
        if (settings.hide_parking?.value) {
          setHideParking(settings.hide_parking.value === 'true');
        }
        if (settings.hide_professional_extensions?.value) {
          setHideProfessionalExtensions(settings.hide_professional_extensions.value === 'true');
        }
        if (settings.exclude_weekend_shifts?.value) {
          setExcludeWeekendShifts(settings.exclude_weekend_shifts.value !== 'false');
        }
        if (settings.restrict_to_department?.value) {
          setRestrictToDepartment(settings.restrict_to_department.value === 'true');
        }
        if (settings.restricted_department_name?.value !== undefined) {
          setRestrictedDepartmentName(settings.restricted_department_name.value || '');
        }
      } catch (error) {
        console.error('Failed to load system name:', error);
      }
    };

    loadSystemSettings();
  }, []);

  const updateSystemName = (name: string) => {
    setSystemName(name);
    // Update document title
    document.title = name;
  };

  const updateDepartmentName = (name: string) => {
    setDepartmentName(name);
  };

  const updateCompanyName = (name: string) => {
    setCompanyName(name);
  };

  const updateHideShifts = (hidden: boolean) => {
    setHideShifts(hidden);
  };

  const updateHideLicenses = (hidden: boolean) => {
    setHideLicenses(hidden);
  };

  const updateHideParking = (hidden: boolean) => {
    setHideParking(hidden);
  };

  const updateHideProfessionalExtensions = (hidden: boolean) => {
    setHideProfessionalExtensions(hidden);
  };

  const updateExcludeWeekendShifts = (enabled: boolean) => {
    setExcludeWeekendShifts(enabled);
  };

  const updateRestrictToDepartment = (enabled: boolean) => {
    setRestrictToDepartment(enabled);
  };

  const updateRestrictedDepartmentName = (name: string) => {
    setRestrictedDepartmentName(name);
  };

  // Update document title when system name changes
  useEffect(() => {
    document.title = systemName;
  }, [systemName]);

  return (
    <SystemContext.Provider
      value={{
        systemName,
        departmentName,
        companyName,
        hideShifts,
        hideLicenses,
        hideParking,
        hideProfessionalExtensions,
        excludeWeekendShifts,
        restrictToDepartment,
        restrictedDepartmentName,
        updateSystemName,
        updateDepartmentName,
        updateCompanyName,
        updateHideShifts,
        updateHideLicenses,
        updateHideParking,
        updateHideProfessionalExtensions,
        updateExcludeWeekendShifts,
        updateRestrictToDepartment,
        updateRestrictedDepartmentName
      }}
    >
      {children}
    </SystemContext.Provider>
  );
};

export const useSystem = () => {
  const context = useContext(SystemContext);
  if (context === undefined) {
    throw new Error('useSystem must be used within a SystemProvider');
  }
  return context;
};
