import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'danger' | 'success' | 'warning' | 'info';
  size?: 'xs' | 'sm' | 'md';
}

const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = 'default', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  const baseClasses = 'font-semibold inline-flex items-center justify-center rounded-full';

  const variantClasses = {
    default: 'bg-gray-100 text-gray-800',
    danger: 'bg-red-100 text-red-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    info: 'bg-blue-100 text-blue-800',
  };

  const sizeClasses = {
    xs: 'px-2 py-0.5 text-xs',
    sm: 'px-2.5 py-0.5 text-sm',
    md: 'px-3 py-1 text-sm',
  };

  const classes = `
    ${baseClasses} 
    ${variantClasses[variant]} 
    ${sizeClasses[size]} 
    ${className}
  `;

  return (
    <span className={classes.trim()} {...props}>
      {children}
    </span>
  );
};

export default Badge;
