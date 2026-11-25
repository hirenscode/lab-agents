// Smart Color Palette Generator
// Converts a simple 5 or 7 color palette into complete theme colors

/**
 * Adjusts the lightness of a hex color
 * @param {string} hex - Hex color (e.g., '#FF0000')
 * @param {number} percent - Percentage to lighten (positive) or darken (negative)
 * @returns {string} Adjusted hex color
 */
function adjustLightness(hex, percent) {
  // Convert hex to RGB
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Convert to HSL
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
      case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
      case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
    }
  }

  // Adjust lightness
  l = Math.max(0, Math.min(1, l + percent / 100));

  // Convert back to RGB
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  let r2, g2, b2;
  if (s === 0) {
    r2 = g2 = b2 = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  // Convert to hex
  const toHex = (c) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/**
 * Converts hex color to rgba with opacity
 * @param {string} hex - Hex color
 * @param {number} opacity - Opacity (0-1)
 * @returns {string} RGBA color string
 */
function hexToRgba(hex, opacity) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Determines if a color is light or dark
 * @param {string} hex - Hex color
 * @returns {boolean} True if light, false if dark
 */
function isLightColor(hex) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

/**
 * Generates complete theme colors from a simple palette
 * @param {string[]} palette - Array of 5 or 7 hex colors
 * @returns {object} Complete color configuration for dark, light, and accent
 */
export function generateFromPalette(palette) {
  // Validate palette
  if (!Array.isArray(palette)) {
    throw new Error('Palette must be an array');
  }

  if (palette.length !== 5 && palette.length !== 7) {
    throw new Error('Palette must contain exactly 5 or 7 colors');
  }

  // Validate all colors are hex
  const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  palette.forEach((color, index) => {
    if (!hexPattern.test(color)) {
      throw new Error(`Color at index ${index} is not a valid hex color: ${color}`);
    }
  });

  const middleIndex = Math.floor(palette.length / 2);

  // Map colors to roles
  const darkBase = palette[0];                    // Left-most
  const darkText = palette[1];                     // Second-left
  const accentPrimary = palette[middleIndex];      // Middle
  const lightText = palette[palette.length - 2];   // Second-right
  const lightBase = palette[palette.length - 1];   // Right-most

  // Generate dark theme colors
  const darkCardBg = adjustLightness(darkBase, 5);  // Slightly lighter than base
  const darkTextSecondary = hexToRgba(darkText, 0.6);
  const darkBorder = hexToRgba(darkText, 0.1);
  const darkShadow = 'rgba(0, 0, 0, 0.8)';
  const darkInputBg = hexToRgba('#000000', 0.2);

  // Generate light theme colors
  const lightCardBg = '#FFFFFF';  // Pure white for cards
  const lightTextSecondary = hexToRgba(lightText, 0.7);
  const lightBorder = hexToRgba(lightText, 0.08);
  const lightShadow = 'rgba(0, 0, 0, 0.1)';
  const lightInputBg = adjustLightness(lightBase, -5);

  // Generate status colors based on accent
  const accentIsLight = isLightColor(accentPrimary);

  return {
    colors: {
      dark: {
        base: darkBase,
        cardBg: darkCardBg,
        textPrimary: darkText,
        textSecondary: darkTextSecondary,
        shadow: darkShadow,
        border: darkBorder,
        inputBg: darkInputBg,
        focusRing: hexToRgba(accentPrimary, 0.5),
        success: 'rgba(16, 185, 129, 0.2)',
        successText: '#10B981',
        error: 'rgba(239, 68, 68, 0.2)',
        errorText: '#EF4444',
        warning: 'rgba(245, 158, 11, 0.2)',
        warningText: '#F59E0B',
        info: hexToRgba(accentPrimary, 0.2),
        infoText: accentPrimary,
      },
      light: {
        base: lightBase,
        cardBg: lightCardBg,
        textPrimary: lightText,
        textSecondary: lightTextSecondary,
        shadow: lightShadow,
        border: lightBorder,
        inputBg: lightInputBg,
        focusRing: hexToRgba(accentPrimary, 0.5),
        success: 'rgba(16, 185, 129, 0.1)',
        successText: '#059669',
        error: 'rgba(239, 68, 68, 0.1)',
        errorText: '#DC2626',
        warning: 'rgba(245, 158, 11, 0.1)',
        warningText: '#D97706',
        info: hexToRgba(accentPrimary, 0.1),
        infoText: accentPrimary,
      },
      accent: {
        primary: accentPrimary,
        // Keep some default accent colors for variety
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
        info: accentPrimary,
        white: '#FFFFFF',
        black: '#000000',
      }
    }
  };
}

/**
 * Validates a custom config and transforms palette if present
 * @param {object} config - Custom configuration object
 * @returns {object} Transformed configuration
 */
export function transformPaletteConfig(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Check if palette is provided
  if (config.palette && Array.isArray(config.palette)) {
    // console.log('🎨 Hexagon UI: Generating theme from color palette:', config.palette);

    try {
      // Generate colors from palette
      const generatedColors = generateFromPalette(config.palette);

      // Merge with any other config properties (typography, spacing, etc.)
      const { palette, colors, ...otherConfig } = config;

      // If manual colors were also provided, merge them (manual takes precedence)
      const finalColors = colors
        ? {
          dark: { ...generatedColors.colors.dark, ...colors.dark },
          light: { ...generatedColors.colors.light, ...colors.light },
          accent: { ...generatedColors.colors.accent, ...colors.accent }
        }
        : generatedColors.colors;

      return {
        ...otherConfig,
        colors: finalColors
      };
    } catch (error) {
      console.error('❌ Hexagon UI: Error generating palette:', error.message);
      console.warn('Falling back to manual color configuration');

      // Remove palette and return rest of config
      const { palette, ...rest } = config;
      return rest;
    }
  }

  // No palette provided, return config as-is
  return config;
}
