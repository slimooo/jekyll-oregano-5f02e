'use client';
import { useCallback, useEffect, useState } from 'react';

import DEFAULTS from '@/data/default-favorites.json';

export interface Fav { s: string; n: string; score?: number; level?: 'buy' | 'watch' | 'avoid'; verdict?: string; at?: string }
const KEY = 'vf-favoris-v1';
const SEEDED = 'vf-favoris-defaut-v1';

/** Ajoute une fois les favoris par défaut (sans écraser ceux déjà enregistrés). */
function seed() {
  try {
    if (localStorage.getItem(SEEDED)) return;
    const cur: Fav[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    const have = new Set(cur.map(f => f.s));
    localStorage.setItem(KEY, JSON.stringify([...cur, ...(DEFAULTS as Fav[]).filter(f => !have.has(f.s))]));
    localStorage.setItem(SEEDED, '1');
  } catch { /* stockage indisponible */ }
}

function read(): Fav[] {
  seed();
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return DEFAULTS as Fav[]; }
}
function write(f: Fav[]) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); window.dispatchEvent(new Event('vf-fav')); } catch { /* stockage indisponible */ }
}

export function useFavorites() {
  const [favs, setFavs] = useState<Fav[]>([]);
  useEffect(() => {
    const sync = () => setFavs(read());
    sync();
    window.addEventListener('vf-fav', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('vf-fav', sync); window.removeEventListener('storage', sync); };
  }, []);
  const isFav = useCallback((s: string) => favs.some(f => f.s === s), [favs]);
  const toggle = useCallback((f: Fav) => {
    const cur = read();
    write(cur.some(x => x.s === f.s) ? cur.filter(x => x.s !== f.s) : [{ ...f, at: new Date().toISOString() }, ...cur]);
  }, []);
  const update = useCallback((f: Fav) => {
    const cur = read();
    if (cur.some(x => x.s === f.s)) write(cur.map(x => (x.s === f.s ? { ...x, ...f } : x)));
  }, []);
  return { favs, isFav, toggle, update };
}
