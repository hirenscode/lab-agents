// --- ATOMIC LABS DESIGN TOKENS ---
// Single source of truth for all styling values
//
// Platform-neutral: this file backs @hirenscode/hexagon-ui's own `.`
// export (its web components import it via ../index.js) *and* its
// `./tokens` and `./native` subpath exports (src/tokens/index.js
// re-exports these names unchanged; src/native's own components import
// this file directly, as siblings under the same package -- see
// packages/design-system/package.json's "exports" map). Values are
// CSS-shaped (rem strings, box-shadow strings, cubic-bezier strings)
// because that's what the web export has always shipped; see
// unitConversion.js for the pieces (spacing/sizing/radii) that convert
// mechanically to RN's plain-number dp units without hand-rolling a
// parallel copy of the numbers.

import { mergeTokens, validateCustomConfig } from './mergeTokens.js';
import { transformPaletteConfig } from './paletteGenerator.js';

// Default design tokens - can be overridden by customize-ui.js
const defaultDesignTokens = {
  colors: {
    dark: {
      base: '#0E0F13',
      cardBg: '#1A1C21',
      textPrimary: '#F4F6F8',
      textSecondary: '#9CA3AF',
      shadow: 'rgba(0, 0, 0, 0.4)',
      border: 'rgba(255, 255, 255, 0.2)',
      inputBg: 'rgba(0,0,0,0.2)',
      focusRing: 'rgba(59, 130, 246, 0.5)',
      success: 'rgba(16, 185, 129, 0.2)',
      successText: '#10B981',
      error: 'rgba(239, 68, 68, 0.2)',
      errorText: '#EF4444',
      warning: 'rgba(245, 158, 11, 0.2)',
      warningText: '#F59E0B',
      info: 'rgba(59, 130, 246, 0.2)',
      infoText: '#3B82F6',
    },
    light: {
      base: '#F4F6F8',
      cardBg: '#FFFFFF',
      textPrimary: '#0E0F13',
      textSecondary: '#4B5563',
      shadow: 'rgba(0, 0, 0, 0.1)',
      border: 'rgba(0, 0, 0, 0.2)',
      inputBg: '#E5E7EB',
      focusRing: 'rgba(59, 130, 246, 0.5)',
      success: 'rgba(16, 185, 129, 0.1)',
      successText: '#059669',
      error: 'rgba(239, 68, 68, 0.1)',
      errorText: '#DC2626',
      warning: 'rgba(245, 158, 11, 0.1)',
      warningText: '#D97706',
      info: 'rgba(59, 130, 246, 0.1)',
      infoText: '#2563EB',
    },
    accent: {
      primary: '#3B82F6', // Atomic Blue
      neonCyan: '#00F5D4',
      auroraPurple: '#A78BFA',
      solarOrange: '#FB923C',
      quantumLime: '#A3E635',
      plasmaPink: '#EC4899',
      carbonGray: '#9CA3AF',
      white: '#FFFFFF',
      black: '#000000',
      success: '#10B981',
      error: '#EF4444',
      warning: '#F59E0B',
      info: '#3B82F6',
      cosmicBlue: '#6366F1',
      stellarPink: '#EC4899',
      galacticGold: '#FBBF24',
    },
  },
  typography: {
    fonts: {
      heading: '"Space Grotesk", sans-serif',
      body: '"Inter", sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    sizes: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem',  // 36px
      '5xl': '3rem',     // 48px
      '6xl': '3.75rem',  // 60px
      '7xl': '4.5rem',   // 72px
    },
    weights: {
      light: 300,
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
    lineHeights: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    }
  },
  spacing: {
    '0': '0',
    '1': '0.25rem',   // 4px
    '2': '0.5rem',    // 8px
    '3': '0.75rem',   // 12px
    '4': '1rem',      // 16px
    '5': '1.25rem',   // 20px
    '6': '1.5rem',    // 24px
    '8': '2rem',      // 32px
    '10': '2.5rem',   // 40px
    '12': '3rem',     // 48px
    '16': '4rem',     // 64px
    '20': '5rem',     // 80px
    '24': '6rem',     // 96px
    '32': '8rem',     // 128px
  },
  shadows: {
    none: '0 0 #0000',
    soft: '0 4px 8px',
    medium: '0 8px 20px',
    hard: '0 12px 28px',
    inner: 'inset 0 2px 4px 0',
  },
  animation: {
    duration: {
      fast: '150ms',
      normal: '300ms',
      slow: '500ms',
    },
    easing: {
      ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },
  borderRadius: {
    none: '0',
    sm: '0.25rem',    // 4px
    base: '0.5rem',   // 8px
    md: '0.75rem',    // 12px
    lg: '1rem',       // 16px
    xl: '1.5rem',     // 24px
    '2xl': '2rem',    // 32px
    full: '9999px',
  },
  components: {
    button: {
      paddingX: '1.5rem',
      paddingY: '0.75rem',
      fontWeight: 700,
      borderRadius: '0.5rem',
      minHeight: '44px',
    },
    card: {
      borderRadius: '1rem',
      padding: '1.5rem',
    },
    avatar: {
      size: '2.5rem',     // 40px
      mediumSize: '4rem',  // 64px
      largeSize: '6rem',   // 96px
    },
    input: {
      borderRadius: '0.5rem',
      paddingX: '1rem',
      paddingY: '0.75rem',
    },
    modal: {
      borderRadius: '1.5rem',
      padding: '2rem',
    },
    dropdown: {
      borderRadius: '0.75rem',
      padding: '0.5rem',
    },
    tooltip: {
      borderRadius: '0.5rem',
      padding: '0.5rem 0.75rem',
    }
  }
};

// Function to create customized design tokens
export function createDesignTokens(customConfig = {}) {
  if (Object.keys(customConfig).length === 0) {
    return defaultDesignTokens;
  }

  // Transform palette if provided
  const transformedConfig = transformPaletteConfig(customConfig);

  // Validate the transformed config
  validateCustomConfig(transformedConfig);

  // Log success message
  if (customConfig.palette) {
    console.log('✓ Hexagon UI: Custom palette applied successfully');
  } else {
    console.log('✓ Hexagon UI: Custom configuration applied');
  }

  return mergeTokens(defaultDesignTokens, transformedConfig);
}

// Export default design tokens (without customization)
export const designTokens = defaultDesignTokens;

// Export the default tokens for reference
export { defaultDesignTokens };
