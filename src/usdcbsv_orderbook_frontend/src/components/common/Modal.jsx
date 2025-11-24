import React from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  titleExtra,
  children,
  size = 'md',
  closeOnBackdrop = true,
}) => {
  const { theme } = useTheme();
  
  if (!isOpen) return null;
  
  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  };
  
  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className={`rounded-2xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] overflow-hidden border ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-gray-900 to-gray-800 border-white/20'
          : 'bg-white border-gray-200'
      }`}>
        <div className={`flex items-center justify-between p-3 sm:p-4 border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex-1 flex items-center justify-between gap-3">
            <h2 className={`text-lg sm:text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
            {titleExtra && <div className="flex-shrink-0">{titleExtra}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg ml-3"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-3 sm:p-4 overflow-y-auto max-h-[calc(90vh-100px)]">
          {children}
        </div>
      </div>
    </div>
  );
};

export { Modal };
export default Modal;
