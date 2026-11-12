'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { Analysis, Category } from '@/lib/analysis';
import BarChart from '@/components/BarChart';
import Scale from '@/components/Scale';
import type { GaugeBand, PriceTargets } from '@/lib/scoring';
import { useFavorites } from '@/lib/favorites';

const nf = (v: number, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
const big = (v: number) => { const a = Math.abs(v); return a >= 1e9 ? nf(v / 1e9) + ' Md' : a >= 1e6 ? nf(v / 1e6) + ' M' : nf(v, 0); };
const fx = (v: number | null, d = 1) => (v === null ? '—' : nf(v, d));
const fp = (v: number | null, d = 1) => (v === null ? '—' : nf(v * 100, d) + ' %');
const status = (s: number | null) => (s === null ? 'na' : s >= 7 ? 'good' : s >= 4 ? 'mid' : 'bad');
const ICON: Record<string, string> = { good: '✓', mid: '!', bad: '✕', na: '–' };
const STATUS_LABEL: Record<string, string> = { good: 'Favorable', mid: 'Moyen', bad: 'Défavorable', na: 'n.d.' };

function Gauge({ score, level }: { score: number; level: Analysis['verdictLevel'] }) {
  const r = 38, c = 2 * Math.PI * r;
  const col = level === 'buy' ? 'var(--good)' : level === 'watch' ? 'var(--mid)' : 'var(--bad)';
  return (
    <svg className="gauge" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Score ${score} sur 100`}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 48 48)" />
      <text x="48" y="52" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--text)">{score}</text>
      <text x="48" y="68" textAnchor="middle" fontSize="10" fill="var(--muted)">/ 100</text>
    </svg>
  );
}

const SCORE_BANDS: GaugeBand[] = [{ from: 0, to: 40, s: 'bad' }, { from: 40, to: 70, s: 'mid' }, { from: 70, to: 100, s: 'good' }];

/** Cours actuel placé sur l'échelle des prix d'achat : vert ≤ prix d'achat, jaune ≤ prix raisonnable, rouge au-delà. */
function PriceCard({ t }: { t: PriceTargets }) {
  const p = t.price;
  const f2 = (v: number) => nf(v, v >= 1000 ? 0 : 2) + ' ' + t.currency;
  const ok = p !== null && t.buy !== null && t.fair !== null;
  let bands: GaugeBand[] = [], lo = 0, hi = 1;
  if (ok) {
    const buy = t.buy as number, fair = t.fair as number;
    hi = Math.max(fair * 1.6, (p as number) * 1.08, buy * 2);
    lo = 0;
    bands = [{ from: lo, to: buy, s: 'good' }, { from: buy, to: fair, s: 'mid' }, { from: fair, to: hi, s: 'bad' }];
  }
  const gap = ok ? (t.buy as number) / (p as number) - 1 : null;
  const zone = !ok ? null : (p as number) <= (t.buy as number) ? 'good' : (p as number) <= (t.fair as number) ? 'mid' : 'bad';
  return (
    <section className="card">
      <h2>Prix de l’action</h2>
      <div className="price-big">{p !== null ? f2(p) : '—'}</div>
      <p className="muted" style={{ margin: '2px 0 0' }}>Cours actuel (différé)</p>
      {ok ? (
        <>
          <Scale v={p as number} lo={lo} hi={hi} bands={bands} unit="price" ccy={t.currency} valueText={f2(p as number)}
            labels={{ good: 'Achat', mid: 'Correct', bad: 'Trop cher' }} />
          <div className="price-grid">
            <div className="kpi"><div className="k">Prix d’achat intéressant</div><div className="v" style={{ color: 'var(--good)' }}>≤ {f2(t.buy as number)}</div></div>
            <div className="kpi"><div className="k">Prix raisonnable max.</div><div className="v" style={{ color: 'var(--mid)' }}>≤ {f2(t.fair as number)}</div></div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '.9rem' }}>
            {zone === 'good' ? <>✓ Le cours est <strong>sous le prix d’achat</strong> calculé ({nf((gap as number) * 100, 0)} % de marge).</>
              : zone === 'mid' ? <>! Le cours est dans la zone raisonnable : il faudrait une baisse de <strong>{nf(-(gap as number) * 100, 0)} %</strong> pour atteindre le prix d’achat.</>
              : <>✕ Le cours est au-dessus du prix raisonnable : il faudrait une baisse de <strong>{nf(-(gap as number) * 100, 0)} %</strong> pour atteindre le prix d’achat.</>}
          </p>
          <details style={{ marginTop: 10 }}>
            <summary>Détail par méthode ({t.methods.length})</summary>
            {t.methods.map(m => {
              const st = (p as number) <= m.buy ? 'good' : (p as number) <= m.fair ? 'mid' : 'bad';
              return (
                <div key={m.id} className="method-row">
                  <div><span className={'dot ' + st} />{m.label}<div className="crit-rule">{m.rule}</div></div>
                  <div className="r">achat ≤ {f2(m.buy)}<div className="crit-rule">raisonnable ≤ {f2(m.fair)}</div></div>
                </div>
              );
            })}
            <p className="crit-rule">Prix retenus : médiane des méthodes. Calcul sur les comptes publiés uniquement, sans prévision.</p>
          </details>
        </>
      ) : <p className="muted">{t.note}</p>}
    </section>
  );
}

function CategoryCard({ c, open, onToggle }: { c: Category; open: boolean; onToggle: () => void }) {
  const st = status(c.score === null ? null : c.score / 10);
  return (
    <section className="card">
      <button className="cat-head" onClick={onToggle} aria-expanded={open}>
        <h2 style={{ margin: 0 }}>{c.label}</h2>
        <span className={'pill ' + st}>{ICON[st]} {c.score === null ? 'n.d.' : `${c.score}/100`}</span>
      </button>
      {c.score !== null ? <Scale v={c.score} lo={0} hi={100} bands={SCORE_BANDS} unit="score" valueText={`${c.score}/100`} compact />
        : <div className="bar-track" />}
      {c.note && <p className="muted" style={{ margin: '6px 0 0' }}>{c.note}</p>}
      {open && c.criteria.map(k => {
        const s = status(k.score);
        return (
          <div key={k.id} className="crit">
            <div className="crit-top">
              <span className="crit-label">{k.label}</span>
              <span className={'pill ' + s} title={STATUS_LABEL[s]}>{ICON[s]}<span className="sr">{STATUS_LABEL[s]}</span></span>
            </div>
            <div className="crit-value" style={{ textAlign: 'left', marginTop: 2 }}>{k.value}</div>
            {k.gauge && <Scale {...k.gauge} />}
            <div className="crit-rule">{k.rule}</div>
            {k.comment && <div className="crit-rule">ℹ︎ {k.comment}</div>}
          </div>
        );
      })}
      {!open && <button className="muted" style={{ background: 'none', border: 0, padding: '6px 0 0', cursor: 'pointer' }} onClick={onToggle}>Voir le détail ({c.criteria.length} critère{c.criteria.length > 1 ? 's' : ''}) ▾</button>}
    </section>
  );
}

export default function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const sym = decodeURIComponent(symbol);
  const [data, setData] = useState<Analysis | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { isFav, toggle, update } = useFavorites();

  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    fetch('/api/analyze/' + encodeURIComponent(sym))
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); return j; })
      .then(j => { if (alive) setData(j); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [sym]);

  useEffect(() => {
    if (data) update({ s: data.symbol, n: data.name, score: data.score, level: data.verdictLevel, verdict: data.verdict,
      price: data.price ?? undefined, buy: data.priceTargets?.buy ?? undefined, fair: data.priceTargets?.fair ?? undefined, ccy: data.currency });
  }, [data, update]);

  if (err) return (
    <div className="card"><h1>{sym}</h1><p>{err}</p><Link href="/" className="btn">← Nouvelle recherche</Link></div>
  );
  if (!data) return (
    <>
      <div className="skeleton" style={{ height: 32, width: '60%', margin: '8px 0' }} />
      <div className="skeleton" style={{ height: 130, marginTop: 12 }} />
      <div className="skeleton" style={{ height: 90, marginTop: 12 }} />
      <div className="skeleton" style={{ height: 90, marginTop: 12 }} />
      <p className="muted">Analyse des comptes, des dividendes et des concurrents…</p>
    </>
  );

  const d = data;
  const fav = isFav(d.symbol);
  const ccy = d.financialCurrency;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href="/" className="muted">← Recherche</Link>
          <h1>{d.name}</h1>
          <p className="sub">{d.symbol} · {d.exchange}{d.sector ? ' · ' + d.sector : ''}</p>
          <p className="sub" style={{ marginTop: 4 }}>
            <strong>{d.price !== null ? nf(d.price, 2) + ' ' + d.currency : '—'}</strong>
            {d.marketCap ? ` · capitalisation ${big(d.marketCap)} ${d.currency}` : ''}
          </p>
        </div>
        <button className={'star' + (fav ? ' on' : '')} style={{ fontSize: '1.9rem' }} aria-label={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={() => toggle({ s: d.symbol, n: d.name, score: d.score, level: d.verdictLevel, verdict: d.verdict })}>{fav ? '★' : '☆'}</button>
      </div>

      <section className="card">
        <div className="hero">
          <Gauge score={d.score} level={d.verdictLevel} />
          <div>
            <div className={'verdict lvl-' + d.verdictLevel}>{d.verdict}</div>
            <p style={{ margin: '4px 0 0', fontSize: '.92rem' }}>{d.verdictText}</p>
          </div>
        </div>
        <Scale v={d.score} lo={0} hi={100} bands={SCORE_BANDS} unit="score" valueText={`${d.score}/100`}
          labels={{ bad: 'Pas pertinent', mid: 'À étudier', good: 'Achat' }} />
        {d.redFlags.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: '.9rem' }}>
            <strong>Signaux d’alerte</strong>
            <ul className="flags" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.redFlags.map(f => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--good)', fontSize: '.85rem' }}>✓ Points forts</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '.82rem' }}>{d.strengths.length ? d.strengths.map(s => <li key={s}>{s}</li>) : <li>—</li>}</ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--bad)', fontSize: '.85rem' }}>✕ Points faibles</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '.82rem' }}>{d.weaknesses.length ? d.weaknesses.map(s => <li key={s}>{s}</li>) : <li>—</li>}</ul>
          </div>
        </div>
      </section>

      {d.priceTargets && <PriceCard t={d.priceTargets} />}

      {d.categories.map(c => <CategoryCard key={c.id} c={c} open={!!open[c.id]} onToggle={() => setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} />)}

      <section className="card">
        <h2>Historique (en {ccy})</h2>
        <BarChart title="Chiffre d'affaires" labels={d.history.years} values={d.history.revenue} format={v => big(v) + ' ' + ccy} />
        {!d.isFinancial && <BarChart title="EBITDA" labels={d.history.years} values={d.history.ebitda} format={v => big(v) + ' ' + ccy} />}
        <BarChart title="Bénéfice net" labels={d.history.years} values={d.history.netIncome} format={v => big(v) + ' ' + ccy} />
        <BarChart title="Dividende versé par action" labels={d.dividends.byYear.map(x => x.year)} values={d.dividends.byYear.map(x => x.amount)} format={v => nf(v, 2) + ' ' + d.dividends.currency} />
        <p className="muted">Touchez une barre pour afficher sa valeur. Exercices annuels publiés ; aucune projection.</p>
      </section>

      {d.peers.length > 1 && (
        <section className="card">
          <h2>Comparaison avec les concurrents</h2>
          <p className="muted" style={{ marginTop: -4 }}>Concurrents de {d.peerSource}, de taille comparable.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Société</th><th>PER</th><th>{d.isFinancial ? 'P/B' : 'VE/EBITDA'}</th><th>Rdt div.</th><th>Marge nette</th><th>ROE</th><th>Dette/CP</th></tr></thead>
              <tbody>
                {d.peers.map(p => (
                  <tr key={p.symbol} className={p.self ? 'self' : ''}>
                    <td>{p.self ? <span>{p.name}</span> : <Link href={`/action/${encodeURIComponent(p.symbol)}`}>{p.name}</Link>}</td>
                    <td>{fx(p.pe)}</td><td>{d.isFinancial ? fx(p.pb, 2) : fx(p.evEbitda)}</td><td>{fp(p.dy)}</td><td>{fp(p.netMargin)}</td><td>{fp(p.roe)}</td><td>{fx(p.de, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.summary && (
        <section className="card">
          <h2>Activité</h2>
          <details><summary>Description de l’entreprise (en anglais)</summary><p style={{ fontSize: '.88rem' }}>{d.summary}</p></details>
        </section>
      )}

      {d.warnings.length > 0 && <p className="muted">⚠︎ {d.warnings.join(' ')}</p>}
      <p className="disclaimer">
        Données : Yahoo Finance (comptes annuels publiés, dividendes versés, cours différé), mises à jour le {new Date(d.updatedAt).toLocaleString('fr-FR')}.
        L’évolution du cours et les prévisions ne sont volontairement pas prises en compte. Rejoué sur 2016-2026 (actions américaines), le score a surtout
        permis d’écarter les sociétés fragiles ; il n’a pas battu l’indice S&amp;P 500. Outil pédagogique, pas un conseil en investissement. <Link href="/methode">Voir la méthode</Link>.
      </p>
    </>
  );
}
