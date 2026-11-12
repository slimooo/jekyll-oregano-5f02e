'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFavorites } from '@/lib/favorites';

const money = (v: number, ccy?: string) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v) + (ccy ? ' ' + ccy : '');

export default function Favoris() {
  const { favs, toggle, update } = useFavorites();
  const [filter, setFilter] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef(false);

  const f = filter.trim().toLowerCase();
  const sorted = [...favs]
    .filter(x => !f || x.n.toLowerCase().includes(f) || x.s.toLowerCase().includes(f))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.n.localeCompare(b.n));
  const counts = { buy: favs.filter(x => x.level === 'buy').length, watch: favs.filter(x => x.level === 'watch').length, avoid: favs.filter(x => x.level === 'avoid').length };

  async function analyzeAll(onlyMissing: boolean) {
    const todo = favs.filter(x => !onlyMissing || typeof x.score !== 'number');
    stop.current = false;
    let done = 0;
    setProgress({ done, total: todo.length });
    const queue = [...todo];
    const worker = async () => {
      while (queue.length && !stop.current) {
        const it = queue.shift()!;
        try {
          const r = await fetch('/api/analyze/' + encodeURIComponent(it.s));
          if (r.ok) { const d = await r.json(); update({ s: it.s, n: it.n, score: d.score, level: d.verdictLevel, verdict: d.verdict, price: d.price ?? undefined, buy: d.priceTargets?.buy ?? undefined, fair: d.priceTargets?.fair ?? undefined, ccy: d.currency }); }
          else update({ s: it.s, n: it.n, verdict: 'analyse indisponible' });
        } catch { /* réseau */ }
        setProgress({ done: ++done, total: todo.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setProgress(null);
  }

  const missing = favs.filter(x => typeof x.score !== 'number').length;
  return (
    <>
      <h1>Mes favoris</h1>
      <p className="sub">{favs.length} action{favs.length > 1 ? 's' : ''}, enregistrées sur cet appareil. Le score se met à jour à chaque consultation.</p>
      {!favs.length ? (
        <div className="card">
          <p>Aucun favori pour l’instant.</p>
          <p className="muted">Touchez l’étoile ☆ à côté d’une action pour l’ajouter.</p>
          <Link href="/" className="btn">Rechercher une action</Link>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="pill good">✓ {counts.buy} achat pertinent</span>
              <span className="pill mid">! {counts.watch} à étudier</span>
              <span className="pill bad">✕ {counts.avoid} pas pertinent</span>
              {missing > 0 && <span className="pill na">– {missing} non analysées</span>}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {progress ? (
                <>
                  <span style={{ alignSelf: 'center' }}>Analyse {progress.done} / {progress.total}…</span>
                  <button className="btn ghost" onClick={() => { stop.current = true; }}>Arrêter</button>
                </>
              ) : (
                <>
                  {missing > 0 && <button className="btn" onClick={() => analyzeAll(true)}>Calculer les scores manquants</button>}
                  <button className={missing > 0 ? 'btn ghost' : 'btn'} onClick={() => analyzeAll(false)}>Tout réanalyser</button>
                </>
              )}
            </div>
            {progress && <div className="bar-track"><div className="bar-fill" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`, background: 'var(--accent)' }} /></div>}
          </div>
          <div className="search">
            <input type="search" placeholder="Filtrer mes favoris" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtrer les favoris" />
          </div>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <ul className="list">
              {sorted.map(x => (
                <li key={x.s} className="row">
                  <Link href={`/action/${encodeURIComponent(x.s)}`} className="main">
                    <div className="name">{x.n}</div>
                    <div className="meta">{x.s}{x.verdict ? ' · ' + x.verdict : ' · pas encore analysée'}</div>
                    {typeof x.price === 'number' && (
                      <div className="meta">
                        <span className={'dot ' + (typeof x.buy !== 'number' ? 'bad' : x.price <= x.buy ? 'good' : typeof x.fair === 'number' && x.price <= x.fair ? 'mid' : 'bad')} />
                        {money(x.price, x.ccy)}{typeof x.buy === 'number' ? ` · achat ≤ ${money(x.buy)}` : ' · pas de prix d’achat'}
                      </div>
                    )}
                  </Link>
                  {typeof x.score === 'number' && <span className={'pill ' + (x.level === 'buy' ? 'good' : x.level === 'watch' ? 'mid' : 'bad')}>{x.score}/100</span>}
                  <button className="star on" aria-label="Retirer des favoris" onClick={() => toggle(x)}>★</button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
