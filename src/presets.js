// Styles. Most presets first redraw the letters from their structure with one pen
// (`structure`), so the style comes from these rules, not from the font; `crowd` grows
// the font's own outlines. All lengths below are in stems (the pen width, or the font's
// stroke thickness without structure).
const pen = { pen: 0.15, spacing: 0.3 };

export const presets = {
  // Round throw-up: one fat, even swell; every gap becomes the same inner line.
  throwup: {
    structure: pen,
    strategies: [
      ['bounce', { y: 0.3, rotate: 4, scale: 0.04 }],
      ['inflate', { amount: 0.5, smooth: 0.15, keep: 0.25 }],
    ],
    // Gaps narrower than ~1 pen become one solid ink line instead of two touching outlines.
    render: { mode: 'stack', stroke: 0.18, ink: 0.45 },
  },

  // Circles packed along the letter structure, grown and merged: lumpy, hand-swollen.
  bubbles: {
    structure: { ...pen, spacing: 0.6 },
    strategies: [
      ['bounce', { y: 0.2, rotate: 3, scale: 0.03 }],
      ['pack', { size: 0.8, vary: 0.35, overlap: 0.25, grow: 1.2, merge: 0.5, keep: 0.25 }],
    ],
    render: { mode: 'stack', stroke: 0.18, ink: 0.45 },
  },

  // Letters that grow until they lock together, wrapped in one outer outline.
  bubble: {
    structure: { ...pen, spacing: 0.6 },
    strategies: [
      ['bounce', { y: 0.25, rotate: 3, scale: 0.03 }],
      ['inflate', { amount: 0.35, smooth: 0.15, keep: 0.25 }],
      ['grow', { amount: 0.6, steps: 6, gap: -0.1, smooth: 0.2, keep: 0.25 }],
    ],
    generations: ['grow', { amount: 1 }, { steps: 6, gap: -0.1, smooth: 0.2, keep: 0.25 }],
    render: { mode: 'stack', stroke: 0.18, outline: 0.6, ink: 0.45 },
  },

  // Heavy blocks with cut corners, filling a rect.
  block: {
    // A square-ended, mitred pen: blocks start out blocky.
    structure: { ...pen, cap: 'square', join: 'miter' },
    envelope: { type: 'rect', height: 1.15 },
    strategies: [
      ['bounce', { y: 0.2, rotate: 2, scale: 0.02 }],
      ['block', { amount: 0.5, keep: 0.25 }],
      ['chamfer', { size: 0.4 }],
    ],
    generations: [['block', { amount: 0.5 }, { keep: 0.25 }], ['chamfer', {}, { size: 0.4 }]],
    render: { mode: 'stack', stroke: 0.18, outline: 0.6, corners: 30, ink: 0.45, lines: { angles: 8, cap: 'square' } },
  },

  // 0/45/90° "simples".
  simple: {
    structure: { ...pen, pen: 0.2, spacing: 0.5, cap: 'square', join: 'miter' },
    strategies: [
      ['block', { amount: 0.25, keep: 0.25 }],
      ['angular', { detail: 0.45, bulge: 'out' }],
      ['stretch', { amount: 1.2, chance: 0.4, directions: ['left', 'right', 'up-right', 'down-left'] }],
      ['angular', { detail: 0.2, bulge: 'out' }],
    ],
    // Straight edges are the point here: no curve fitting.
    generations: [['block', { amount: 0.3 }, { keep: 0.25 }], ['angular', {}, { detail: 0.2, bulge: 'out' }]],
    render: { mode: 'stack', stroke: 0.14, curves: 0, lines: { angles: 8, cap: 'square' } },
  },

  // The throw-up swell on the font's own outlines (no skeleton), lines and letters
  // packed into each other and split into shared seams.
  crowd: {
    structure: false,
    lineHeight: 0.5,
    tracking: -1,
    repel: true,
    strategies: [
      ['bounce', { y: 0.3, rotate: 4, scale: 0.04 }],
      ['inflate', { amount: 0.5, smooth: 0.15, keep: 0.25 }],
    ],
    render: { mode: 'stack', stroke: 0.18, ink: 0.45 },
  },

  // Simulations (after nshelton.github.io/home/growth). Slower: seconds, not ms.

  // Differential line growth: the outline wrinkles as it grows, like coral.
  coral: {
    structure: { ...pen, spacing: 0.8 },
    strategies: [['inflate', { amount: 0.2, smooth: 0 }], ['coral', {}]],
    generations: ['coral', { steps: 90, reach: 1 }, { from: 'shape' }],
    render: { mode: 'stack', stroke: 0.15, ink: 0.3 },
  },

  // Diffusion-limited aggregation: particles freeze onto the letters.
  frost: {
    structure: { ...pen, spacing: 0.2 },
    strategies: [['inflate', { amount: 0.2, smooth: 0 }], ['dla', { reach: 1.2, particles: 0.8 }]],
    generations: ['dla', { reach: 1.2, particles: 0.8 }],
    render: { mode: 'stack', stroke: 0.15, ink: 0.3 },
  },

};
