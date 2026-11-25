// Utility function to deeply merge custom configuration with default design tokens
// This function allows partial overrides while preserving the complete token structure

export function mergeTokens(defaultTokens, customConfig = {}) {
  // Deep merge function that handles nested objects
  function deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        // If the value is an object, recursively merge it
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        // If the value is primitive or array, override it
        result[key] = source[key];
      }
    }

    return result;
  }

  return deepMerge(defaultTokens, customConfig);
}

// Helper function to validate that custom config has proper structure
export function validateCustomConfig(config) {
  const validTopLevelKeys = ['colors', 'typography', 'spacing', 'shadows', 'animation', 'borderRadius', 'components', 'logging', 'animationLevel'];
  const warnings = [];

  for (const key in config) {
    if (!validTopLevelKeys.includes(key)) {
      warnings.push(`Unknown top-level key: "${key}". Valid keys are: ${validTopLevelKeys.join(', ')}`);
    }
  }

  // Validate colors structure
  if (config.colors) {
    const validColorThemes = ['dark', 'light', 'accent'];
    for (const theme in config.colors) {
      if (!validColorThemes.includes(theme)) {
        warnings.push(`Unknown color theme: "${theme}". Valid themes are: ${validColorThemes.join(', ')}`);
      }
    }
  }

  // Validate typography structure
  if (config.typography) {
    const validTypographyKeys = ['fonts', 'sizes', 'weights', 'lineHeights'];
    for (const key in config.typography) {
      if (!validTypographyKeys.includes(key)) {
        warnings.push(`Unknown typography key: "${key}". Valid keys are: ${validTypographyKeys.join(', ')}`);
      }
    }
  }

  // Validate components structure
  if (config.components) {
    const validComponents = ['button', 'card', 'avatar', 'input', 'modal', 'dropdown', 'tooltip', 'betaRibbon'];
    for (const component in config.components) {
      if (!validComponents.includes(component)) {
        warnings.push(`Unknown component: "${component}". Valid components are: ${validComponents.join(', ')}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('Hexagon UI Customization Warnings:', warnings);
  }

  return warnings.length === 0;
}
