import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Valeur Fondamentale — analyse d’actions', short_name: 'Valeur',
    description: 'Faut-il acheter cette action ? Analyse selon les critères de Buffett et Graham.',
    start_url: '/', display: 'standalone', background_color: '#f6f7f9', theme_color: '#2456d6', lang: 'fr',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
