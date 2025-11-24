import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const Select = ({ 
  label, 
  options = [],
  error, 
  helperText,
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
      <select
        className={`w-full rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none cursor-pointer ${
          theme === 'dark'
            ? `bg-white/5 border ${error ? 'border-red-500' : 'border-white/20'} text-white`
            : `bg-white border ${error ? 'border-red-500' : 'border-gray-300'} text-gray-900`
        } ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.5rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1.5em 1.5em',
          paddingRight: '2.5rem',
        }}
        {...props}
      >
        {options.map((option, index) => (
          <option 
            key={index} 
            value={option.value} 
            className={theme === 'dark' ? 'bg-gray-800' : 'bg-white'}
          >
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-sm text-red-400">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-gray-400">{helperText}</p>
      )}
    </div>
  );
};

export { Select };
export default Select;
