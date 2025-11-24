import React from 'react';

/**
 * Tooltip component for helpful hints
 */
export const Tooltip = ({ children, content, position = 'top' }) => {
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div className="group relative inline-block">
      {children}
      <div className={`
        absolute ${positionClasses[position]} z-50
        hidden group-hover:block
        px-3 py-2 
        bg-gray-900 text-white text-sm rounded-lg
        whitespace-nowrap
        shadow-lg border border-white/10
        animate-fadeIn
      `}>
        {content}
        <div className={`
          absolute w-2 h-2 bg-gray-900 border-white/10
          ${position === 'top' ? 'bottom-[-4px] left-1/2 -translate-x-1/2 border-b border-r' : ''}
          ${position === 'bottom' ? 'top-[-4px] left-1/2 -translate-x-1/2 border-t border-l' : ''}
          ${position === 'left' ? 'right-[-4px] top-1/2 -translate-y-1/2 border-r border-b' : ''}
          ${position === 'right' ? 'left-[-4px] top-1/2 -translate-y-1/2 border-l border-t' : ''}
          rotate-45
        `} />
      </div>
    </div>
  );
};

/**
 * Info icon with tooltip
 */
export const InfoTooltip = ({ content, position = 'top' }) => {
  return (
    <Tooltip content={content} position={position}>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 text-xs cursor-help">
        i
      </span>
    </Tooltip>
  );
};

/**
 * Fade in transition wrapper
 */
export const FadeIn = ({ children, delay = 0, className = '' }) => {
  return (
    <div 
      className={`animate-fadeIn ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

/**
 * Slide up transition wrapper
 */
export const SlideUp = ({ children, delay = 0, className = '' }) => {
  return (
    <div 
      className={`animate-slideUp ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

/**
 * Success checkmark animation
 */
export const SuccessAnimation = ({ size = 64 }) => {
  return (
    <div className="relative inline-flex items-center justify-center">
      <div className="absolute inset-0 bg-green-400/20 rounded-full animate-ping" />
      <svg 
        className="animate-scaleIn" 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none"
      >
        <circle 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="2" 
          className="text-green-400"
        />
        <path 
          d="M7 12L10 15L17 8" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="text-green-400 animate-drawCheck"
        />
      </svg>
    </div>
  );
};

/**
 * Loading spinner with text
 */
export const LoadingSpinner = ({ text, size = 'md' }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`${sizes[size]} border-4 border-white/10 border-t-purple-500 rounded-full animate-spin`} />
      {text && <p className="text-gray-400 text-sm animate-pulse">{text}</p>}
    </div>
  );
};

/**
 * Progress bar with animation
 */
export const ProgressBar = ({ progress, label, showPercentage = true }) => {
  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex justify-between items-center mb-2">
          {label && <span className="text-sm text-gray-400">{label}</span>}
          {showPercentage && <span className="text-sm font-semibold text-white">{Math.round(progress)}%</span>}
        </div>
      )}
      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Badge with pulse animation for new/active states
 */
export const PulseBadge = ({ children, color = 'purple' }) => {
  const colorClasses = {
    purple: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    green: 'bg-green-500/20 text-green-300 border-green-500/30',
    red: 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  return (
    <span className={`
      relative inline-flex items-center gap-2 
      px-3 py-1 rounded-full text-xs font-semibold border
      ${colorClasses[color]}
    `}>
      <span className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color === 'purple' ? 'bg-purple-400' : color === 'blue' ? 'bg-blue-400' : color === 'green' ? 'bg-green-400' : 'bg-red-400'}`}></span>
        <span className={`relative inline-flex rounded-full h-2 w-2 ${color === 'purple' ? 'bg-purple-500' : color === 'blue' ? 'bg-blue-500' : color === 'green' ? 'bg-green-500' : 'bg-red-500'}`}></span>
      </span>
      {children}
    </span>
  );
};

export default {
  Tooltip,
  InfoTooltip,
  FadeIn,
  SlideUp,
  SuccessAnimation,
  LoadingSpinner,
  ProgressBar,
  PulseBadge,
};
