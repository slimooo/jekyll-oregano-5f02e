'use client';
import { useState } from 'react';

/** Histogramme mono-série : barres fines, valeur affichée au toucher / survol. */
export default function BarChart({ labels, values, format, title }: { labels: (string | number)[]; values: (number | null)[]; format: (v: number) => string; title: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const vals = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  if (!vals.some(v => v !== null)) return <p className="muted">{title} : données indisponibles.</p>;
  const W = 320, H = 130, top = 8, bottom = 22;
  const max = Math.max(0, ...vals.map(v => v ?? 0));
  const min = Math.min(0, ...vals.map(v => v ?? 0));
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * (H - top - bottom);
  const n = vals.length;
  const slot = W / n;
  const bw = Math.min(28, slot * 0.6);
  const shown = sel ?? vals.length - 1;
  return (
    <figure style={{ margin: '0 0 14px' }}>
      <figcaption style={{ fontWeight: 600, fontSize: '.9rem' }}>{title}</figcaption>
      <div className="chart-tip" aria-live="polite">
        {labels[shown]} : <strong>{vals[shown] === null ? 'n.d.' : format(vals[shown] as number)}</strong>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} onMouseLeave={() => setSel(null)}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        {vals.map((v, i) => {
          const cx = slot * i + slot / 2;
          const step = Math.ceil(n / 8);
          const show = n <= 8 || (i % step === 0 && n - 1 - i >= step) || i === n - 1;
          return (
            <g key={i} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
              {v !== null && (
                <rect x={cx - bw / 2} width={bw} y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))}
                  rx={3} fill={v < 0 ? 'var(--bar-neg)' : 'var(--bar)'} opacity={sel === null || sel === i ? 1 : 0.45} />
              )}
              {show && <text x={i === 0 ? Math.max(cx - bw / 2, 0) : i === n - 1 ? Math.min(cx + bw / 2, W) : cx} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={10} fill="var(--muted)">{labels[i]}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
