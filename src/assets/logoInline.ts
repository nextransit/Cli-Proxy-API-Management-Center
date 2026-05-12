/**
 * Inline Logo (SVG, base64 encoded for single-file builds)
 * Design: Network nodes - three nodes connected in a triangle
 * Symbolizes "user → proxy → AI provider" routing relationship
 */

export const INLINE_LOGO_SVG = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="nodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366F1"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366F1" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <!-- Connection lines -->
  <line x1="24" y1="12" x2="12" y2="36" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="24" y1="12" x2="36" y2="36" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="12" y1="36" x2="36" y2="36" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Nodes -->
  <circle cx="24" cy="12" r="6" fill="url(#nodeGrad)"/>
  <circle cx="12" cy="36" r="5" fill="url(#nodeGrad)"/>
  <circle cx="36" cy="36" r="5" fill="url(#nodeGrad)"/>
  <!-- Center dot on top node -->
  <circle cx="24" cy="12" r="2.5" fill="white" fill-opacity="0.9"/>
</svg>`);

export const INLINE_LOGO_JPEG = INLINE_LOGO_SVG; // Alias for backward compatibility
