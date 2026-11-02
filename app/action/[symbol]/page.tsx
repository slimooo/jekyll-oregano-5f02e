'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { Analysis, Category } from '@/lib/analysis';
import BarChart from '@/components/BarChart';
import { useFavorites } from '@/lib/favorites';

const nf = (v: number, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
const big = (v: number) => { const a = Math.abs(v); return a >= 1e9 ? nf(v / 1e9) + ' Md' : a >= 1e6 ? nf(v / 1e6) + ' M' : nf(v, 0); };
const fx = (v: number | null, d = 1) => (v === null ? '—' : nf(v, d));
const fp = (v: number | null, d = 1) => (v === null ? '—' : nf(v * 100, d) + ' %');
const status = (s: number | null) => (s === null ? 'na' : s >= 7 ? 'good' : s >= 4 ? 'mid' : 'bad');
const ICON: Record<string, string> = { good: '✓', mid: '!', bad: '✕', na: '–' };
const STATUS_LABEL: Record<string, string> = { good: 'Favorable', mid: 'Moyen', bad: 'Défavorable', na: 'n.d.' };
const color = (s: number | null) => `var(--${status(s === null ? null : s / 10)})`;

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

function CategoryCard({ c, open, onToggle }: { c: Category; open: boolean; onToggle: () => void }) {
  const st = status(c.score === null ? null : c.score / 10);
  return (
    <section className="card">
      <button className="cat-head" onClick={onToggle} aria-expanded={open}>
        <h2 style={{ margin: 0 }}>{c.label}</h2>
        <span className={'pill ' + st}>{ICON[st]} {c.score === null ? 'n.d.' : `${c.score}/100`}</span>
      </button>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${c.score ?? 0}%`, background: color(c.score) }} /></div>
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
    if (data) update({ s: data.symbol, n: data.name, score: data.score, level: data.verdictLevel, verdict: data.verdict });
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
        L’évolution du cours et les prévisions ne sont volontairement pas prises en compte. Outil pédagogique, pas un conseil en investissement. <Link href="/methode">Voir la méthode</Link>.
      </p>
    </>
  );
}
