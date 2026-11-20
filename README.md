# ViralFlow

Busca videos virales en YouTube, detecta qué nichos están calientes y organiza un proyecto de trabajo por carpetas para replicar el formato con Google Flow.

**Estado: Fases 1, 2 y 3.** Buscador con puntaje viral y ranking de nichos → análisis del video elegido centrado en su **gancho** y su perfil de estilo → guion con un prompt por escena para Google Flow → subes los clips que generes en Flow y la app los edita (voz en off, subtítulos, música) y exporta **un mp4 por plataforma**.

## Arrancar

```bash
npm install
cp .env.example .env      # y pega YOUTUBE_API_KEY y GEMINI_API_KEY
npm run dev               # API en :3001 y panel en http://localhost:5173
```

Sin API key puedes probar el panel: botón **Cargar datos de demo** (datos sintéticos, marcados como «Demo» y fáciles de borrar).

Para producción: `npm run build && npm start` sirve la API y el panel juntos en el puerto 3001.

## Conseguir la API key de YouTube

1. En [Google Cloud Console](https://console.cloud.google.com/) crea (o elige) un proyecto.
2. **APIs y servicios → Biblioteca →** busca **YouTube Data API v3** y pulsa **Habilitar**.
3. **APIs y servicios → Credenciales → Crear credenciales → Clave de API.**
4. Pégala en `.env` como `YOUTUBE_API_KEY`. Si le pones restricciones, que no sean de *referrer* ni de IP del navegador: la clave se usa desde el servidor.

La cuota gratuita es de **10.000 unidades al día** (se reinicia a medianoche, hora del Pacífico). El panel muestra lo gastado y estima el costo antes de cada escaneo.

| Operación | Costo |
|---|---|
| Buscar por nicho o palabra clave (`search.list`) | 100 por página de 50 resultados |
| Detalles de videos y suscriptores de canales | 1 por llamada de hasta 50 |
| Tendencias por categoría (`mostPopular`) | 1 por página |

Un escaneo de 6 nichos con 1 página cuesta unas 612 unidades. **Tendencias** es casi gratis: úsalo a diario y reserva las búsquedas por nicho.

## Cómo se calcula el puntaje viral (0–100)

| Señal | Peso | Qué mide |
|---|---|---|
| Velocidad | 40 % | Vistas por hora. Si el video se escaneó más de una vez, usa el crecimiento real entre escaneos; si no, vistas ÷ horas desde que se publicó |
| Frente a su canal | 30 % | Vistas ÷ suscriptores. Un video que supera varias veces a su canal es replicable aunque el canal sea pequeño |
| Interacción | 15 % | (me gusta + comentarios) ÷ vistas |
| Alcance | 15 % | Vistas totales, en escala logarítmica |

Si falta una señal (suscriptores ocultos, me gusta ocultos) su peso se reparte entre las demás en vez de penalizar al video. Cada tarjeta tiene un botón **Cómo se calculó** con el desglose.

> **Para medir bien «las primeras horas»:** YouTube no entrega el historial de vistas de un video, así que la app lo construye. Cada escaneo guarda un snapshot; con dos o más escaneos separados por horas, el crecimiento deja de ser una estimación. Escanea con la opción **Los más recientes** un par de veces al día.

## Ranking de nichos

`calor = 50 % promedio de los 5 mejores videos + 25 % promedio general + 25 % oportunidad`

La *oportunidad* es el porcentaje de videos de canales con menos de 100.000 suscriptores que superaron al menos 3 veces su tamaño y pasaron de 10.000 vistas. Un nicho caliente con mucha oportunidad es el más fácil de replicar. Los nichos con pocos videos o pocos canales se marcan como *pocos datos*.

El panel trae 20 nichos de partida (consultas en español); puedes añadir más con `POST /api/niches`.

## Flujo de trabajo

1. **Videos / Nichos:** escanea YouTube y elige un video viral.
2. **Proyecto → Análisis:** Gemini ve el video y describe el gancho (qué se ve, qué se dice, qué rompe el scroll, plantilla reutilizable) y el perfil de estilo (cámara, color, cortes, subtítulos, voz, música).
3. **Guion y prompts:** aplica la mecánica del gancho a tu tema, con 3 ganchos alternativos intercambiables, y un prompt por escena para Flow.
4. **Clips y video final:** pega los prompts en [Google Flow](https://labs.google/fx/tools/flow), descarga los clips y arrástralos a su escena. Elige voz, subtítulos (preseleccionados según el video de referencia), música y formatos, y pulsa **Generar video**.

El resultado queda en `07-exportados/<formato>/` y se descarga desde la app.

### Cómo edita
- FFmpeg viene en `ffmpeg-static` (o usa el del sistema, o `FFMPEG_PATH`). Cada escena se recorta al formato, se mezcla su voz con el sonido ambiente del clip y se queman los subtítulos; después se unen y, si hay música, se mezcla a bajo volumen.
- Voz: Gemini TTS (`GEMINI_TTS_MODEL`). Se guarda por escena y se reutiliza si no cambió el texto ni la voz; con límite de peticiones espera y reintenta.
- Duración: manda la voz; si el clip es más corto se congela el último fotograma (máx. 2 s) y, si no alcanza, se acelera la voz hasta 1,25×.
- Los subtítulos se reparten **en proporción al largo del texto** dentro de cada escena, no palabra por palabra; el desfase es de décimas de segundo.
- Solo se genera un video a la vez. Límites de subida: clips 600 MB, música 80 MB.
- La música no se incluye: sube una pista con licencia.

## Carpetas de cada proyecto

Se crean dentro de `workspace/<nombre-del-proyecto>/`:

```
00-referencia/        video.json con los datos del video viral
01-analisis/
02-guion/
03-prompts-flow/
04-clips/             los clips que descargues de Flow
05-voz-y-musica/
06-subtitulos/
07-exportados/
  tiktok/format.json  una carpeta por plataforma elegida, con resolución,
  youtube-shorts/     relación de aspecto y duración recomendada
project.json · README.md
```

Formatos incluidos: TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, Instagram Feed (4:5) y YouTube horizontal. Son una guía de partida: las plataformas cambian sus límites, revísalos antes de publicar.

## Estructura del código

```
server/src/
  youtube.ts    cliente de la API (errores traducidos, cuenta de cuota)
  scoring.ts    puntaje viral          analytics.ts  nichos y términos en alza
  scanner.ts    escaneos y estimación de costo
  projects.ts   carpetas y etapas      formats.ts    presets por plataforma
  gemini.ts     texto, video y voz     content.ts    análisis y guion
  clips.ts      subidas y música       render.ts     edición con FFmpeg
  captions.ts   subtítulos ASS         voice.ts      voz en off
  demo.ts       datos sintéticos       *.test.ts     41 pruebas
client/src/     panel en React + Tailwind
```

`npm test` corre las pruebas (puntaje, ranking y un escaneo completo con la API de YouTube simulada, sin gastar cuota). `npm run typecheck` revisa ambos paquetes.

## Qué falta verificar contigo

- El nombre del modelo de voz (`GEMINI_TTS_MODEL`) y si tu clave gratuita lo permite: cámbialo en `.env` si Google lo renombra.
- Google Flow no tiene API gratuita, por eso la generación de clips es manual. El editor no depende del origen de los clips, así que luego se puede añadir otro proveedor.

## Uso responsable

El sistema sirve para estudiar qué formatos funcionan y recrearlos con contenido propio. Adapta el gancho, el ritmo y la estructura; no copies tal cual el video de otra persona.
