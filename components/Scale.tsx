import type { GaugeBand, GaugeUnit } from '@/lib/scoring';

export type ScaleUnit = GaugeUnit | 'score';

const nf = (v: number, d: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);

export function fmtUnit(v: number, unit: ScaleUnit, ccy?: string): string {
  const a = Math.abs(v);
  switch (unit) {
    case 'pct': return nf(v * 100, a * 100 < 10 ? 1 : 0) + ' %';
    case 'pts': return (v > 0 ? '+' : '') + nf(v * 100, 1) + ' pts';
    case 'x': return nf(v, a < 10 ? 1 : 0) + ' x';
    case 'yrs': return nf(v, a < 10 ? 1 : 0) + ' ans';
    case 'score': return nf(v, 0);
    case 'num': return nf(v, a < 10 ? 1 : 0);
    default: return nf(v, 2) + (ccy ? ' ' + ccy : '');
  }
}

const ZONE: Record<GaugeBand['s'], string> = { bad: 'Défavorable', mid: 'Moyen', good: 'Favorable' };

/**
 * Échelle horizontale à trois couleurs (rouge / jaune / vert) avec la valeur affichée dans une bulle,
 * comme sur une balance connectée. Les seuils entre zones sont écrits au-dessus de la barre.
 */
export default function Scale({ v, lo, hi, bands, unit, ccy, valueText, zoneLabels = true, compact = false, labels }: {
  v: number; lo: number; hi: number; bands: GaugeBand[]; unit: ScaleUnit | 'price'; ccy?: string;
  valueText?: string; zoneLabels?: boolean; compact?: boolean; labels?: Partial<Record<GaugeBand['s'], string>>;
}) {
  const fmt = (n: number) => fmtUnit(n, unit as ScaleUnit, ccy);
  const span = hi - lo || 1;
  const pos = (n: number) => Math.max(0, Math.min(100, ((n - lo) / span) * 100));
  const p = pos(v);
  const out = v < lo ? '‹ ' : v > hi ? ' ›' : '';
  const zone = bands.find(b => v >= b.from && v <= b.to) ?? (v < lo ? bands[0] : bands[bands.length - 1]);
  const cuts = bands.slice(0, -1).map(b => b.to);
  const text = valueText ?? fmt(v);
  return (
    <div className={'scale' + (compact ? ' compact' : '')} role="img"
      aria-label={`${text} — zone ${ZONE[zone.s].toLowerCase()} (${bands.map(b => `${ZONE[b.s]} ${fmt(b.from)} à ${fmt(b.to)}`).join(', ')})`}>
      <div className="scale-bubble-row">
        <div className={'scale-bubble z-' + zone.s} style={{ left: `${p}%`, transform: `translateX(-${p}%)` }}>
          {v < lo ? '‹ ' : ''}{text}{v > hi ? ' ›' : ''}
        </div>
      </div>
      <div className="scale-arrow-row"><span className={'scale-arrow z-' + zone.s} style={{ left: `${p}%` }} /></div>
      <div className="scale-ticks">
        {cuts.map((c, i) => {
          // seuils proches : le premier s'aligne à gauche du trait, le suivant à droite, pour ne pas se chevaucher
          const close = (j: number) => j >= 0 && j < cuts.length - 1 && pos(cuts[j + 1]) - pos(cuts[j]) < 22;
          const tf = close(i) ? 'translateX(calc(-100% - 2px))' : close(i - 1) ? 'translateX(2px)' : 'translateX(-50%)';
          return <span key={i} style={{ left: `${pos(c)}%`, transform: tf }}>{fmt(c)}</span>;
        })}
      </div>
      <div className="scale-bar">
        {bands.map((b, i) => (
          <span key={i} className={'z-' + b.s} style={{ width: `${pos(b.to) - pos(b.from)}%` }} />
        ))}
      </div>
      {zoneLabels && !compact && (
        <div className="scale-zones">
          {bands.map((b, i) => (
            <span key={i} style={{ width: `${pos(b.to) - pos(b.from)}%` }} className={zone === b ? 'on z-txt-' + b.s : ''}>
              {(() => { const t = labels?.[b.s] ?? ZONE[b.s]; return (pos(b.to) - pos(b.from)) * 0.95 >= t.length * 2.1 ? t : ''; })()}
            </span>
          ))}
        </div>
      )}
      {out && <span className="sr">valeur hors de l’échelle</span>}
    </div>
  );
}
