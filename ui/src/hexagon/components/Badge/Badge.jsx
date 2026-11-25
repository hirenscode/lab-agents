import React from 'react';
import { designTokens } from '../../tokens/designTokens.js';
import { useDesignTokens } from '../../utils/ConfigProvider.jsx';

export const Badge = ({
  children,
  variant = 'default',
  color = 'primary',
  size = 'medium',
  dot = false,
  theme: themeProp,
  className = '',
  ...props
}) => {
  const context = useDesignTokens();
  const theme = context?.theme || themeProp || 'dark';
  const tokens = context?.designTokens || designTokens;

  const sizeMap = {
    small: {
      padding: `${tokens.spacing['0']} ${tokens.spacing['2']}`,
      fontSize: tokens.typography.sizes.xs,
      height: '18px',
      dotSize: '6px',
    },
    medium: {
      padding: `${tokens.spacing['1']} ${tokens.spacing['2']}`,
      fontSize: tokens.typography.sizes.xs,
      height: '22px',
      dotSize: '8px',
    },
    large: {
      padding: `${tokens.spacing['1']} ${tokens.spacing['3']}`,
      fontSize: tokens.typography.sizes.sm,
      height: '26px',
      dotSize: '10px',
    },
  };

  const currentSize = sizeMap[size] || sizeMap.medium;

  // Get color from tokens or use custom color
  const badgeColor = tokens.colors.accent[color] || color;

  const getBackgroundColor = () => {
    switch (variant) {
      case 'filled':
        return badgeColor;
      case 'outlined':
        return 'transparent';
      case 'subtle':
        return `${badgeColor}20`;
      default:
        return badgeColor;
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'filled':
        return (color === 'neonCyan' || color === 'quantumLime')
          ? tokens.colors.light.textPrimary
          : '#fff';
      case 'outlined':
        return badgeColor;
      case 'subtle':
        return badgeColor;
      default:
        return '#fff';
    }
  };

  const getBorder = () => {
    if (variant === 'outlined') {
      return `1px solid ${badgeColor}`;
    }
    return 'none';
  };

  if (dot) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-block',
          width: currentSize.dotSize,
          height: currentSize.dotSize,
          borderRadius: '50%',
          backgroundColor: badgeColor,
          border: `2px solid ${tokens.colors[theme].cardBg}`,
        }}
        {...props}
      />
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: currentSize.padding,
        minHeight: currentSize.height,
        backgroundColor: getBackgroundColor(),
        color: getTextColor(),
        border: getBorder(),
        borderRadius: '9999px',
        fontFamily: tokens.typography.fonts.body,
        fontSize: currentSize.fontSize,
        fontWeight: tokens.typography.weights.medium,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        transition: 'all 0.2s ease',
      }}
      {...props}
    >
      {children}
    </span>
  );
};
