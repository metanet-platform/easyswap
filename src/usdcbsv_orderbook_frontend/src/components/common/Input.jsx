import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const Input = ({ 
  label, 
  error, 
  helperText,
  leftIcon,
  rightIcon,
  className = '',
  containerClassName = '',
  ...props 
}) => {
  const { theme } = useTheme();
  
  return (
    <div className={`w-full ${containerClassName}`}>
      {label && (
        <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {leftIcon}
          </div>
        )}
        <input
          className={`w-full rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
            theme === 'dark'
              ? `bg-white/5 border ${error ? 'border-red-500' : 'border-white/20'} text-white placeholder-gray-400`
              : `bg-white border ${error ? 'border-red-500' : 'border-gray-300'} text-gray-900 placeholder-gray-500`
          } ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {rightIcon && (
          <div className={`absolute right-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {rightIcon}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-400">{error}</p>
      )}
      {helperText && !error && (
        <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{helperText}</p>
      )}
    </div>
  );
};

export { Input };
export default Input;
