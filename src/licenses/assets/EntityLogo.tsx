import React from 'react';

interface EntityLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const EntityLogo: React.FC<EntityLogoProps> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <img
        src={require('./entity-logo.png')}
        alt="Entity Logo"
        className="w-full h-full object-contain"
      />
    </div>
  );
};

export default EntityLogo;
