'use client';
import Link from 'next/link';
import { useFavorites } from '@/lib/favorites';

export default function Favoris() {
  const { favs, toggle } = useFavorites();
  const sorted = [...favs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <>
      <h1>Mes favoris</h1>
      <p className="sub">Enregistrés sur cet appareil. Le score se met à jour à chaque consultation de l’action.</p>
      {!favs.length ? (
        <div className="card">
          <p>Aucun favori pour l’instant.</p>
          <p className="muted">Touchez l’étoile ☆ à côté d’une action pour l’ajouter.</p>
          <Link href="/" className="btn">Rechercher une action</Link>
        </div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ul className="list">
            {sorted.map(f => (
              <li key={f.s} className="row">
                <Link href={`/action/${encodeURIComponent(f.s)}`} className="main">
                  <div className="name">{f.n}</div>
                  <div className="meta">{f.s}{f.verdict ? ' · ' + f.verdict : ' · pas encore analysée'}</div>
                </Link>
                {typeof f.score === 'number' && <span className={'pill ' + (f.level === 'buy' ? 'good' : f.level === 'watch' ? 'mid' : 'bad')}>{f.score}/100</span>}
                <button className="star on" aria-label="Retirer des favoris" onClick={() => toggle(f)}>★</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
