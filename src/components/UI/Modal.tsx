import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  header?: React.ReactNode;
  hideHeader?: boolean;
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md',
  header,
  hideHeader = false
}) => {
  // Close modal on Escape key press
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const portalRoot = typeof document !== 'undefined' ? document.body : null;
  if (!portalRoot) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  return createPortal(
    <div className="fixed inset-0 z-50" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex min-h-screen items-start justify-center px-4 pb-8 sm:pb-10">
        <div
          className={`relative w-full ${sizeClasses[size]} max-h-[calc(100vh-8rem)] m-auto transform rounded-lg bg-white shadow-xl transition-all flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {!hideHeader && (
            header ? (
              header
            ) : (
              <div className="flex items-center justify-between p-6 border-b border-gray-200 shrink-0">
                <h3 className="text-lg font-semibold text-gray-900">
                  {title}
                </h3>
                <button
                  onClick={onClose}
                  className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )
          )}

          {/* Content */}
          <div className="flex-1 min-h-0  p-6 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>,
    portalRoot
  );
};

export default Modal;
