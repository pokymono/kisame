import { svgEl } from './dom';

export function iconArrowRight(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4 text-white/70',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M4 12h14m0 0-4-4m4 4-4 4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconFolder(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4 text-white/70',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z',
          'stroke-linejoin': 'round',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M3 6v-1a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconSessions(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4 text-white/70',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' },
    children: [
      svgEl('path', {
        attrs: { d: 'M4 7h16M4 12h16M4 17h10', 'stroke-linecap': 'round' },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconTimeline(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4 text-white/70',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M5 12h5l2-5 4 10 3-5h2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconChat(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4 text-white/70',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M4 5h16v10H7l-3 3z',
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

// New icons for cyberpunk theme

export function iconShark(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M2 18h20',
          'stroke-linecap': 'round',
          'stroke-opacity': '0.4',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M4 18C6 14 8 10 12 6c1 4 3 8 8 12H4Z',
          fill: 'currentColor',
          'fill-opacity': '0.12',
          'stroke-linejoin': 'round',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M11 12c0 2 1 4 3 6',
          'stroke-linecap': 'round',
          'stroke-opacity': '0.5',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconRadar(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('circle', {
        attrs: {
          cx: '12',
          cy: '12',
          r: '9',
        },
      }),
      svgEl('circle', {
        attrs: {
          cx: '12',
          cy: '12',
          r: '5',
          'stroke-opacity': '0.5',
        },
      }),
      svgEl('circle', {
        attrs: {
          cx: '12',
          cy: '12',
          r: '1',
          fill: 'currentColor',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M12 12l6-6',
          'stroke-linecap': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconTerminal(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('rect', {
        attrs: {
          x: '3',
          y: '4',
          width: '18',
          height: '16',
          rx: '2',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M7 9l3 3-3 3',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M13 15h4',
          'stroke-linecap': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconWave(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0 2 0 2 0',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconHex(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z',
          'stroke-linejoin': 'round',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M12 8v8',
          'stroke-linecap': 'round',
          'stroke-opacity': '0.5',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M8 10l8 4',
          'stroke-linecap': 'round',
          'stroke-opacity': '0.5',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconShield(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M12 3l8 4v5c0 5-3.5 9-8 11-4.5-2-8-6-8-11V7l8-4z',
          'stroke-linejoin': 'round',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M9 12l2 2 4-4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconNetwork(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('circle', { attrs: { cx: '12', cy: '5', r: '2' } }),
      svgEl('circle', { attrs: { cx: '5', cy: '19', r: '2' } }),
      svgEl('circle', { attrs: { cx: '19', cy: '19', r: '2' } }),
      svgEl('path', {
        attrs: {
          d: 'M12 7v4M12 11l-5.5 6M12 11l5.5 6',
          'stroke-linecap': 'round',
        },
      }),
    ],
  }) as SVGSVGElement;
}

export function iconPacket(): SVGSVGElement {
  return svgEl('svg', {
    className: 'size-4',
    attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
    children: [
      svgEl('rect', {
        attrs: {
          x: '4',
          y: '4',
          width: '16',
          height: '16',
          rx: '1',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M4 9h16M9 9v11',
          'stroke-opacity': '0.5',
        },
      }),
      svgEl('path', {
        attrs: {
          d: 'M13 13h4M13 16h2',
          'stroke-linecap': 'round',
          'stroke-opacity': '0.7',
        },
      }),
    ],
  }) as SVGSVGElement;
}
