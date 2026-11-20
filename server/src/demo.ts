import { db } from './db.js';
import { saveBatch, type StoredVideo } from './store.js';
import type { RawChannel } from './types.js';

/** PRNG determinista: la demo siempre genera los mismos datos base. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES: Record<string, string[]> = {
  motivacion: [
    'Lo que hice a las 5 a.m. durante 30 días me cambió la vida',
    'Si sientes que vas tarde, mira esto',
    'La regla de los 2 minutos contra la procrastinación',
    'Deja de esperar motivación y haz esto',
  ],
  finanzas: [
    'Cómo ahorrar tu primer millón sin ganar más',
    '3 errores de dinero que te mantienen pobre',
    'El método de los sobres que usan los que sí ahorran',
    'No inviertas antes de ver esto',
  ],
  curiosidades: [
    'El animal que nunca duerme y nadie sabe por qué',
    '5 datos que no te enseñaron en el colegio',
    'Por qué el cielo no es azul como crees',
    'Lo que pasa si dejas de parpadear',
  ],
  ia: [
    'Esta IA hace tu video en 2 minutos',
    '5 herramientas de inteligencia artificial gratis para hoy',
    'Le pedí a una IA que diseñara mi casa',
    'Cómo automaticé mi negocio con inteligencia artificial',
  ],
  misterio: [
    'El caso sin resolver que aún persigue a la policía',
    'Desapareció sin dejar rastro: lo que encontraron después',
    'La llamada que nunca debieron contestar',
    'Misterio en el pueblo que nadie quiere nombrar',
  ],
  cocina: [
    'Receta fácil de 3 ingredientes que sale perfecta',
    'El error que arruina tu arroz todos los días',
    'Cena rápida en 10 minutos sin horno',
    'Receta fácil de postre sin azúcar',
  ],
  humor: [
    'Cuando tu mamá te dice que bajes a saludar',
    'Chistes que solo entienden los colombianos',
    'POV: llegaste tarde a la fiesta de tu familia',
    'Humor de oficina que todos hemos vivido',
  ],
  fitness: [
    'Rutina de gimnasio de 15 minutos para todo el cuerpo',
    'El ejercicio que casi todos hacen mal',
    'Rutina de ejercicio sin equipo en casa',
    'Así cambió mi cuerpo en 60 días',
  ],
};

const CATEGORY_BY_NICHE: Record<string, string> = {
  motivacion: '22',
  finanzas: '27',
  curiosidades: '27',
  historia: '27',
  ia: '28',
  tecnologia: '28',
  ciencia: '28',
  gaming: '20',
  humor: '23',
  mascotas: '15',
  autos: '2',
  moda: '26',
  cocina: '26',
  fitness: '17',
};

const generic = (name: string): string[] => [
  `${name}: lo que nadie te cuenta`,
  `3 cosas que debes saber sobre ${name.toLowerCase()}`,
  `Esto cambió mi forma de ver ${name.toLowerCase()}`,
  `Lo mejor de ${name.toLowerCase()} en 30 segundos`,
];

const HOUR = 3_600_000;

export function demoCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM videos WHERE source = 'demo'").get() as { n: number }).n;
}

export function clearDemo(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM videos WHERE source = 'demo'").run();
    db.prepare("DELETE FROM channels WHERE id LIKE 'demo_ch_%'").run();
  })();
}

/** Genera datos sintéticos (marcados como demo) para probar el dashboard sin API key. */
export function seedDemo(): number {
  clearDemo();
  const niches = db.prepare('SELECT id, slug, name, query FROM niches').all() as Array<{
    id: number;
    slug: string;
    name: string;
    query: string;
  }>;
  const rand = mulberry32(20261116);
  const now = Date.now();

  const channels: RawChannel[] = [];
  const videos: StoredVideo[] = [];
  const earlier: Array<{ id: string; at: string; views: number }> = [];

  for (const niche of niches) {
    // Cada nicho tiene un "calor" distinto para que el ranking no sea plano.
    const boost = 0.5 + rand() * 1.8;
    const nicheChannels = Array.from({ length: 4 }, (_, k) => {
      const channel: RawChannel = {
        id: `demo_ch_${niche.slug}_${k}`,
        title: `Canal ${niche.name.split(' ')[0]} ${k + 1}`,
        subscribers: Math.round(10 ** (3.3 + rand() * 3.2)),
        videoCount: 40 + Math.floor(rand() * 400),
        viewCount: null,
      };
      channels.push(channel);
      return channel;
    });

    const titles = TITLES[niche.slug] ?? generic(niche.name);
    for (let i = 0; i < 9; i++) {
      const channel = nicheChannels[Math.floor(rand() * nicheChannels.length)]!;
      const ageHours = 3 + rand() * 24 * 13;
      const outlier = rand() < 0.14 ? 3 + rand() * 15 : 1;
      const maturity = Math.min(1, 0.15 + ageHours / 96);
      const views = Math.round((channel.subscribers ?? 5000) * 10 ** (rand() * 2 - 1) * outlier * boost * maturity);
      const id = `demo_${niche.slug}_${i}`;

      videos.push({
        nicheIds: [niche.id],
        raw: {
          id,
          channelId: channel.id,
          channelTitle: channel.title,
          title: titles[i % titles.length]!,
          description: `Video de demostración del nicho ${niche.name}.`,
          thumbnail: '',
          publishedAt: new Date(now - ageHours * HOUR).toISOString(),
          durationS: 12 + Math.floor(rand() * 46),
          categoryId: CATEGORY_BY_NICHE[niche.slug] ?? '24',
          tags: niche.query.split(' ').concat(niche.slug),
          language: 'es',
          views,
          likes: Math.round(views * (0.025 + rand() * 0.07)),
          comments: Math.round(views * (0.0008 + rand() * 0.005)),
          liveBroadcast: 'none',
        },
      });

      // Un snapshot anterior en ~55% de los videos permite mostrar crecimiento medido.
      if (rand() < 0.55 && ageHours > 6) {
        const hoursBack = 2 + rand() * Math.min(20, ageHours - 3);
        const share = Math.min(0.9, (hoursBack / ageHours) * (0.4 + rand() * 0.8));
        earlier.push({
          id,
          at: new Date(now - hoursBack * HOUR).toISOString(),
          views: Math.round(views * (1 - share)),
        });
      }
    }
  }

  saveBatch(videos, channels, 'demo', new Date(now));
  const insertSnap = db.prepare('INSERT OR IGNORE INTO video_snapshots (video_id, taken_at, views) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const s of earlier) insertSnap.run(s.id, s.at, s.views);
  })();

  return videos.length;
}
