import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const Card = ({ 
  children, 
  title, 
  subtitle,
  className = '',
  hover = false,
  ...props 
}) => {
  const { theme } = useTheme();
  const hoverClasses = hover ? 'hover:scale-105 hover:shadow-2xl cursor-pointer' : '';
  
  return (
    <div 
      className={`backdrop-blur-md rounded-2xl p-4 sm:p-5 shadow-xl transition-all duration-300 ${
        theme === 'dark'
          ? 'bg-white/10 border border-white/20'
          : 'bg-white/80 border border-gray-200'
      } ${hoverClasses} ${className}`}
      {...props}
    >
      {(title || subtitle) && (
        <div className="mb-3">
          {title && <h3 className={`text-xl sm:text-2xl font-bold mb-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{title}</h3>}
          {subtitle && <p className={`text-xs sm:text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
};

export { Card };
export default Card;
