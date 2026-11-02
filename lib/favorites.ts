'use client';
import { useCallback, useEffect, useState } from 'react';

export interface Fav { s: string; n: string; score?: number; level?: 'buy' | 'watch' | 'avoid'; verdict?: string; at?: string }
const KEY = 'vf-favoris-v1';

function read(): Fav[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
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
