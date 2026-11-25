import React from 'react';
import { designTokens } from '../../tokens/designTokens.js';
import { useDesignTokens } from '../../utils/ConfigProvider.jsx';

export const Card = ({
  children,
  className = '',
  theme: themeProp,
  variant = 'default',
  padding = 'default',
  elevation = 'medium',
  hoverable = false,
  ...props
}) => {
  // Use theme from context if available, fallback to prop or 'dark'
  const context = useDesignTokens();
  const theme = context?.theme || themeProp || 'dark';
  const tokens = context?.designTokens || designTokens;

  // Padding configurations
  const paddingConfig = {
    none: '0',
    small: tokens.spacing['4'],
    medium: tokens.components.card.padding,
    default: tokens.components.card.padding,
    large: tokens.spacing['8'],
  };

  // Elevation configurations
  const elevationConfig = {
    none: 'none',
    soft: tokens.shadows.soft,
    medium: tokens.shadows.medium,
    hard: tokens.shadows.hard,
  };

  // Variant configurations
  const variantConfig = {
    default: {
      backgroundColor: tokens.colors[theme].cardBg,
      border: `1px solid ${tokens.colors[theme].border}`
    },
    outlined: {
      backgroundColor: 'transparent',
      border: `2px solid ${tokens.colors[theme].border}`
    },
    filled: {
      backgroundColor: tokens.colors[theme].inputBg,
      border: 'none'
    },
    elevated: {
      backgroundColor: tokens.colors[theme].cardBg,
      border: 'none'
    }
  };

  const currentVariant = variantConfig[variant];
  const currentPadding = paddingConfig[padding];
  const currentElevation = elevationConfig[elevation];

  return (
    <div
      className={`
        backdrop-blur-sm transition-all duration-300
        ${hoverable ? 'hover:scale-[1.02] cursor-pointer' : ''}
        ${className}
      `}
      style={{
        backgroundColor: currentVariant.backgroundColor,
        borderRadius: tokens.components.card.borderRadius,
        padding: currentPadding,
        boxShadow: currentElevation !== 'none'
          ? `${currentElevation} ${tokens.colors[theme].shadow}`
          : 'none',
        border: currentVariant.border,
        color: tokens.colors[theme].textPrimary,
        ...props.style
      }}
      {...props}
    >
      {children}
    </div>
  );
};
