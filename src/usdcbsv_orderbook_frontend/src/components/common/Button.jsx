import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  disabled = false, 
  loading = false,
  onClick,
  className = '',
  ...props 
}) => {
  const { theme } = useTheme();
  const baseClasses = 'font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';
  
  const variants = {
    primary: 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl',
    secondary: theme === 'dark'
      ? 'bg-gray-500/70 backdrop-blur-sm border border-gray-400 hover:bg-gray-400 text-white shadow-md'
      : 'bg-gray-200 backdrop-blur-sm border border-gray-300 hover:bg-gray-300 text-gray-900 shadow-md',
    success: 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg',
    danger: 'bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white shadow-lg',
    outline: theme === 'dark'
      ? 'border-2 border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white'
      : 'border-2 border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white',
    ghost: theme === 'dark'
      ? 'hover:bg-white/10 text-gray-400 hover:text-white'
      : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-base',
    lg: 'px-7 py-3.5 text-lg',
  };
  
  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {children}
    </button>
  );
};

export { Button };
export default Button;
