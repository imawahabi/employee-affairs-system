import React from 'react';

interface PageHeaderProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  title,
  description,
  actions,
  children,
}) => (
  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white/80 p-7 shadow-lg backdrop-blur-sm">
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="mt-2 text-md text-gray-600">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-4 lg:justify-end">
          {actions}
        </div>
      )}
    </div>
    {children}
  </div>
);

export default PageHeader;
