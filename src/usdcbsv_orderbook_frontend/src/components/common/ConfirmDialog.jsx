import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from './';

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  loading = false,
}) => {
  const { theme } = useTheme();
  
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      button: 'danger'
    },
    warning: {
      button: 'primary'
    },
    info: {
      button: 'primary'
    }
  };

  const currentVariant = variantStyles[variant] || variantStyles.danger;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      <div className={`relative rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border ${
        theme === 'dark'
          ? 'bg-gray-900 border-white/20'
          : 'bg-white border-gray-200'
      }`}>
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 transition-colors ${
            theme === 'dark'
              ? 'text-gray-400 hover:text-white'
              : 'text-gray-500 hover:text-gray-900'
          }`}
          disabled={loading}
        >
          <X size={20} />
        </button>

        <div className="pr-8">
          <div className="mb-4">
            <h3 className={`text-xl font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </h3>
            <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              {message}
            </p>
          </div>

          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              {cancelText}
            </Button>
            <Button
              variant={currentVariant.button}
              onClick={onConfirm}
              loading={loading}
              disabled={loading}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
