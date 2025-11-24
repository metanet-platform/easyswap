import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const Loader = ({ size = 'md', text = '' }) => {
  const { theme } = useTheme();
  const sizes = {
    sm: 'w-6 h-6',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };
  
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className={`${sizes[size]} relative`}>
        <div className={`absolute inset-0 rounded-full border-4 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'}`}></div>
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 border-r-purple-500 animate-spin"></div>
      </div>
      {text && <p className={`text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{text}</p>}
    </div>
  );
};

export { Loader };
export default Loader;
