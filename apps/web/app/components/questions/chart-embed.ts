import { mergeAttributes, Node } from '@tiptap/core';

export type QuestionChartType = 'bar' | 'pie' | 'line';

function readJsonAttribute<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {
    return fallback;
  }
}

export const ChartEmbed = Node.create({
  name: 'chartEmbed',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      chartType: {
        default: 'bar',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-chart-type') || 'bar',
        renderHTML: (attributes: { chartType: QuestionChartType }) => ({
          'data-chart-type': attributes.chartType,
        }),
      },
      labels: {
        default: [],
        parseHTML: (element: HTMLElement) => readJsonAttribute<string[]>(element.getAttribute('data-chart-labels'), []),
        renderHTML: (attributes: { labels: string[] }) => ({
          'data-chart-labels': encodeURIComponent(JSON.stringify(attributes.labels)),
        }),
      },
      values: {
        default: [],
        parseHTML: (element: HTMLElement) => readJsonAttribute<number[]>(element.getAttribute('data-chart-values'), []),
        renderHTML: (attributes: { values: number[] }) => ({
          'data-chart-values': encodeURIComponent(JSON.stringify(attributes.values)),
        }),
      },
      width: {
        default: '100%',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-chart-width') || '100%',
        renderHTML: (attributes: { width: '50%' | '100%' }) => ({
          'data-chart-width': attributes.width,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-chart-embed]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const chartType = (node.attrs.chartType || 'bar') as QuestionChartType;
    const labels = (node.attrs.labels || []) as string[];
    const values = (node.attrs.values || []) as number[];
    const width = (node.attrs.width || '100%') as '50%' | '100%';
    const colors = ['#3083ff', '#10b981', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'];

    let chartVisual: unknown[];

    if (chartType === 'pie') {
      const total = values.reduce((sum, v) => sum + (v || 0), 0) || 1;
      const C = 2 * Math.PI * 36; // radius 36 => C ≈ 226.19
      let accumulated = 0;

      const slices = values.map((val, idx) => {
        const fraction = Math.max(0, val || 0) / total;
        const dashLen = fraction * C;
        const offset = -accumulated;
        accumulated += dashLen;
        const color = colors[idx % colors.length];
        return [
          'circle',
          {
            cx: '60',
            cy: '60',
            r: '36',
            fill: 'none',
            stroke: color,
            'stroke-width': '22',
            'stroke-dasharray': `${dashLen.toFixed(2)} ${C.toFixed(2)}`,
            'stroke-dashoffset': offset.toFixed(2),
          },
        ];
      });

      const legendItems = labels.map((label, idx) => {
        const val = values[idx] ?? 0;
        const pct = Math.round(((val || 0) / total) * 100);
        const color = colors[idx % colors.length];
        return [
          'div',
          { style: 'display:flex;align-items:center;gap:6px;font-size:11px;color:#334155;white-space:nowrap' },
          ['span', { style: `width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;shrink:0` }],
          ['span', { style: 'font-weight:600' }, `${label}:`],
          ['span', { style: 'color:#64748b' }, `${val} (${pct}%)`],
        ];
      });

      chartVisual = [
        'div',
        {
          role: 'img',
          'aria-label': `Grafik Lingkaran: ${labels.join(', ')}`,
          style: 'display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap;padding:0.75rem;background:#fff;border-radius:0.5rem;border:1px dashed #cbd5e1;min-height:160px',
        },
        [
          'svg',
          {
            viewBox: '0 0 120 120',
            width: '120',
            height: '120',
            style: 'transform:rotate(-90deg);flex-shrink:0',
          },
          ...slices,
        ],
        [
          'div',
          { style: 'display:flex;flex-direction:column;gap:6px;max-height:140px;overflow-y:auto;padding-right:4px' },
          ...legendItems,
        ],
      ];
    } else if (chartType === 'line') {
      const maxValue = Math.max(1, ...values);
      const points = values.map((val, idx) => {
        const x = labels.length > 1 ? 25 + (idx / (labels.length - 1)) * 250 : 150;
        const y = 130 - ((val || 0) / maxValue) * 100;
        return { x, y, val, label: labels[idx] };
      });
      const polylinePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

      const circles = points.map((p, idx) => [
        'g',
        {},
        [
          'circle',
          {
            cx: p.x.toFixed(1),
            cy: p.y.toFixed(1),
            r: '4',
            fill: '#3083ff',
            stroke: '#ffffff',
            'stroke-width': '2',
          },
        ],
        [
          'text',
          {
            x: p.x.toFixed(1),
            y: (p.y - 7).toFixed(1),
            'text-anchor': 'middle',
            'font-size': '10',
            'font-weight': 'bold',
            fill: '#1e293b',
          },
          String(p.val),
        ],
        [
          'text',
          {
            x: p.x.toFixed(1),
            y: '145',
            'text-anchor': 'middle',
            'font-size': '10',
            fill: '#64748b',
          },
          String(p.label || ''),
        ],
      ]);

      chartVisual = [
        'div',
        {
          role: 'img',
          'aria-label': `Grafik Garis: ${labels.join(', ')}`,
          style: 'padding:0.5rem;background:#fff;border-radius:0.5rem;border:1px dashed #cbd5e1;overflow-x:auto',
        },
        [
          'svg',
          {
            viewBox: '0 0 300 155',
            width: '100%',
            height: '155',
            style: 'display:block;margin:0 auto;max-width:400px',
          },
          // Baseline grid
          ['line', { x1: '15', y1: '130', x2: '285', y2: '130', stroke: '#e2e8f0', 'stroke-width': '1.5' }],
          // Polyline
          ['polyline', { fill: 'none', stroke: '#3083ff', 'stroke-width': '2.5', points: polylinePoints }],
          ...circles,
        ],
      ];
    } else {
      // Default: Bar chart
      const maxValue = Math.max(1, ...values);
      const bars = labels.map((label, index) => [
        'div',
        { style: 'display:flex;flex:1;max-width:56px;min-width:0;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:6px' },
        ['div', {
          title: `${label}: ${values[index] ?? 0}`,
          style: `width:100%;height:${Math.max(8, (((values[index] || 0) / maxValue) * 100)).toFixed(1)}%;background:${colors[index % colors.length]};border-radius:4px 4px 0 0`,
        }],
        ['span', { style: 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#475569' }, label],
      ]);

      chartVisual = [
        'div',
        {
          role: 'img',
          'aria-label': `Grafik Batang: ${labels.join(', ')}`,
          style: 'display:flex;align-items:stretch;justify-content:center;gap:0.75rem;height:170px;padding:0.5rem;background:#fff;border-radius:0.5rem;border:1px dashed #cbd5e1',
        },
        ...bars,
      ];
    }

    const typeTitle = chartType === 'pie' ? 'LINGKARAN' : chartType === 'line' ? 'GARIS' : 'BATANG';

    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-chart-embed': 'true',
        class: 'chart-container',
        style: `box-sizing:border-box;display:${width === '50%' ? 'inline-block' : 'block'};vertical-align:top;width:${width === '50%' ? '48%' : '100%'};max-width:500px;margin:${width === '50%' ? '0.5rem 1%' : '1rem auto'};padding:1rem;background:#f8fafc;border-radius:0.75rem;border:1px solid #e2e8f0;text-align:center`,
      }),
      ['figcaption', { style: 'font-weight:700;margin-bottom:0.75rem;font-size:0.875rem;color:#1e293b' }, `Grafik Data (${typeTitle})`],
      chartVisual,
    ];
  },
});
