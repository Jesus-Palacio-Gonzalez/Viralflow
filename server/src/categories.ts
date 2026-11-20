/** Categorías de YouTube (IDs estables de la API) con nombre en español. */
export const CATEGORIES: Record<string, string> = {
  '1': 'Cine y animación',
  '2': 'Autos y vehículos',
  '10': 'Música',
  '15': 'Mascotas y animales',
  '17': 'Deportes',
  '19': 'Viajes y eventos',
  '20': 'Gaming',
  '22': 'Gente y blogs',
  '23': 'Comedia',
  '24': 'Entretenimiento',
  '25': 'Noticias y política',
  '26': 'Estilo y how-to',
  '27': 'Educación',
  '28': 'Ciencia y tecnología',
  '29': 'ONG y activismo',
};

/** Categorías que se escanean por defecto en el modo "tendencias". */
export const DEFAULT_TRENDING_CATEGORIES = ['1', '2', '10', '15', '17', '20', '22', '23', '24', '26', '27', '28'];
