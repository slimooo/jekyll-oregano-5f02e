'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Recherche', d: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z' },
  { href: '/favoris', label: 'Favoris', d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z' },
  { href: '/methode', label: 'Méthode', d: 'M5 4h10l4 4v12H5V4Zm2 2v12h10V9h-3V6H7Zm2 5h6v2H9v-2Zm0 4h6v2H9v-2Z' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Navigation principale">
      {items.map(i => {
        const active = i.href === '/' ? path === '/' || path.startsWith('/action') : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? 'active' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={i.d} /></svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
