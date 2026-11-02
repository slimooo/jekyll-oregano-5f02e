'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useFavorites } from '@/lib/favorites';

interface Hit { s: string; n: string; x: string; sec: string; region: string; mc: number; inDb: boolean }

const SUGGESTIONS = [
  ['MC.PA', 'LVMH'], ['TTE.PA', 'TotalEnergies'], ['AAPL', 'Apple'], ['KO', 'Coca-Cola'], ['SAP.DE', 'SAP'],
  ['NESN.SW', 'Nestlé'], ['ASML.AS', 'ASML'], ['JNJ', 'Johnson & Johnson'], ['AI.PA', 'Air Liquide'], ['MSFT', 'Microsoft'],
];

export default function Home() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const { favs, isFav, toggle } = useFavorites();
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setHits([]); return; }
      ctl.current?.abort();
      const c = new AbortController(); ctl.current = c;
      setLoading(true);
      try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(q), { signal: c.signal });
        setHits((await r.json()).hits ?? []);
      } catch { /* requête annulée */ } finally { if (!c.signal.aborted) setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <h1>Valeur Fondamentale</h1>
      <p className="sub">Faut-il acheter cette action ? Analyse selon les critères de Buffett & Graham.</p>
      <div className="search">
        <input type="search" inputMode="search" autoComplete="off" placeholder="Nom, ticker ou ISIN (ex. Total, AAPL, FR0000120271)"
          value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher une action" />
      </div>

      {q.trim() ? (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {loading && !hits.length && <p className="muted">Recherche…</p>}
          {!loading && !hits.length && <p className="muted">Aucune action trouvée.</p>}
          <ul className="list">
            {hits.map(h => (
              <li key={h.s} className="row">
                <Link href={`/action/${encodeURIComponent(h.s)}`} className="main">
                  <div className="name">{h.n}</div>
                  <div className="meta">{h.s} · {h.x}{h.region ? ' · ' + h.region : ''}{h.sec ? ' · ' + h.sec : ''}</div>
                </Link>
                <button className={'star' + (isFav(h.s) ? ' on' : '')} aria-label={isFav(h.s) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  onClick={() => toggle({ s: h.s, n: h.n })}>{isFav(h.s) ? '★' : '☆'}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {favs.length > 0 && (
            <div className="card">
              <h2>Mes favoris</h2>
              <ul className="list">
                {favs.slice(0, 5).map(f => (
                  <li key={f.s} className="row">
                    <Link href={`/action/${encodeURIComponent(f.s)}`} className="main">
                      <div className="name">{f.n}</div>
                      <div className="meta">{f.s}{f.verdict ? ' · ' + f.verdict : ''}</div>
                    </Link>
                    {typeof f.score === 'number' && <span className={'pill ' + (f.level === 'buy' ? 'good' : f.level === 'watch' ? 'mid' : 'bad')}>{f.score}/100</span>}
                  </li>
                ))}
              </ul>
              {favs.length > 5 && <Link href="/favoris">Voir les {favs.length} favoris →</Link>}
            </div>
          )}
          <div className="card">
            <h2>Exemples</h2>
            <div className="chips">
              {SUGGESTIONS.map(([s, n]) => <Link key={s} href={`/action/${encodeURIComponent(s)}`} className="chip">{n}</Link>)}
            </div>
          </div>
          <p className="disclaimer">
            Base de plus de 13 000 actions (États-Unis, Europe, Japon, Hong Kong, Canada, Australie…) couvrant l’univers proposé par les
            courtiers comme Trade Republic, complétée par une recherche en ligne. Outil pédagogique : ceci n’est pas un conseil en investissement.
          </p>
        </>
      )}
    </>
  );
}
