import React from 'react';
import { designTokens } from '../../tokens/designTokens.js';
import { useDesignTokens } from '../../utils/ConfigProvider.jsx';
import { useAnalytics } from '../../context/AnalyticsContext.js';

export const Button = React.forwardRef(({
  children,
  color = 'primary',
  onClick,
  theme: themeProp,
  variant = 'primary', // Support both 'primary'/'secondary' and 'filled'/'outline'/'text'
  size = 'medium',
  disabled = false,
  isLoading = false,
  className = '',
  type = 'button',
  fullWidth = false,
  ...props
}, ref) => {
  // Use theme from context if available, fallback to prop or 'dark'
  const context = useDesignTokens();
  const theme = context?.theme || themeProp || 'dark';
  const tokens = context?.designTokens || designTokens;
  const { track } = useAnalytics();

  // Map common variant names to internal variants
  const variantMap = {
    'primary': 'filled',
    'secondary': 'outline',
    'ghost': 'text',
    'filled': 'filled',
    'outline': 'outline',
    'text': 'text'
  };

  const internalVariant = variantMap[variant] || 'filled';
  const isFilled = internalVariant === 'filled';
  const isOutline = internalVariant === 'outline';
  const isText = internalVariant === 'text';

  // Size configurations
  const sizeConfig = {
    small: {
      paddingY: tokens.spacing['1'],
      paddingX: tokens.spacing['3'],
      fontSize: tokens.typography.sizes.sm,
      minHeight: '32px',
    },
    medium: {
      paddingY: tokens.spacing['2'],
      paddingX: tokens.spacing['4'],
      fontSize: tokens.typography.sizes.base,
      minHeight: '38px',
    },
    large: {
      paddingY: tokens.spacing['3'],
      paddingX: tokens.spacing['6'],
      fontSize: tokens.typography.sizes.lg,
      minHeight: '44px',
    }
  };

  const currentSize = sizeConfig[size];
  const accentColor = tokens.colors.accent[color] || tokens.colors.accent.primary;

  // Color configurations based on variant
  let backgroundColor, textColor, borderColor;

  if (isFilled) {
    backgroundColor = accentColor;
    textColor = (color === 'neonCyan' || color === 'quantumLime')
      ? tokens.colors.light.textPrimary
      : tokens.colors.dark.textPrimary;
    borderColor = 'transparent';
  } else if (isOutline) {
    backgroundColor = 'transparent';
    textColor = accentColor;
    borderColor = accentColor;
  } else if (isText) {
    backgroundColor = 'transparent';
    textColor = tokens.colors[theme].textPrimary;
    borderColor = 'transparent';
  }

  const handleClick = (e) => {
    if (disabled || isLoading) return;

    track('Button Click', {
      component: 'Button',
      label: typeof children === 'string' ? children : 'Complex Button',
      variant,
      size,
      color
    });

    onClick?.(e);
  };

  // Extract style from props to merge it properly
  const { style: customStyle, ...restProps } = props;

  return (
    <button
      ref={ref}
      type={type}
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={`
        transition-all duration-300 transform
        hover:scale-105 active:scale-95
        inline-flex items-center justify-center
        font-semibold rounded-lg
        ${isText ? 'hover:bg-opacity-10' : ''}
        ${isOutline ? 'hover:bg-opacity-10' : ''}
        ${fullWidth ? 'w-full' : ''}
        ${disabled || isLoading ? '' : 'hover-shadow-responsive'}
        ${className}
      `}
      style={{
        backgroundColor: backgroundColor,
        color: textColor,
        padding: `${currentSize.paddingY} ${currentSize.paddingX}`,
        fontFamily: tokens.typography.fonts.heading,
        fontWeight: tokens.components.button.fontWeight,
        fontSize: currentSize.fontSize,
        borderRadius: tokens.components.button.borderRadius,
        border: `1px solid ${borderColor}`,
        cursor: (disabled || isLoading) ? 'not-allowed' : 'pointer',
        boxShadow: isFilled ? `${tokens.shadows.soft} ${tokens.colors[theme].shadow}` : 'none',
        opacity: (disabled || isLoading) ? 0.7 : 1,
        gap: tokens.spacing['2'],
        minHeight: currentSize.minHeight,
        // Focus visible styles for keyboard navigation
        outline: 'none',
        ...(!isFilled && !isText && {
          ':hover': {
            backgroundColor: `${accentColor}10`
          }
        }),
        // Merge custom styles LAST so they can override internal styles
        ...customStyle
      }}
      onFocus={(e) => {
        // Add visible focus ring for keyboard navigation
        e.target.style.boxShadow = `0 0 0 3px ${accentColor}40, ${isFilled ? `${tokens.shadows.soft} ${tokens.colors[theme].shadow}` : 'none'}`;
        e.target.style.outline = `2px solid ${accentColor}`;
        e.target.style.outlineOffset = '2px';
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        // Remove focus ring
        e.target.style.boxShadow = isFilled ? `${tokens.shadows.soft} ${tokens.colors[theme].shadow}` : 'none';
        e.target.style.outline = 'none';
        e.target.style.outlineOffset = '0';
        props.onBlur?.(e);
      }}
      {...restProps}
    >
      {isLoading ? (
        <div
          className="border-2 rounded-full spinner"
          style={{
            width: '20px',
            height: '20px',
            borderColor: `${textColor}30`,
            borderTopColor: textColor
          }}
        />
      ) : children}
    </button>
  );
});

// Display name for debugging
Button.displayName = 'Button';
