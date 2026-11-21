<img width="324" height="87" alt="{25A2C00C-E915-4E9E-9C59-F4218FB227C2}" src="https://github.com/user-attachments/assets/6ae30baa-efbc-4ea6-a7c9-f75a630d4cd2" />

# Guía de uso de ViralFlow

De «¿qué está funcionando en YouTube?» a un mp4 listo para subir, en cinco pasos. Esta guía es para usar la herramienta; la instalación y los detalles técnicos están en el [README](README.md).

## Antes de empezar

Necesitas dos claves gratuitas en el archivo `.env`:

| Clave | Para qué | Dónde se saca |
|---|---|---|
| `YOUTUBE_API_KEY` | Buscar videos y medir su rendimiento | Google Cloud Console → YouTube Data API v3 → Credenciales |
| `GEMINI_API_KEY` | Analizar el video, escribir el guion y generar la voz | [aistudio.google.com](https://aistudio.google.com) → Get API key |

Arranca con `npm run dev` y abre http://localhost:5173. Si aún no tienes las claves, pulsa **Cargar datos de demo** para recorrer la herramienta con videos de ejemplo (aparecen marcados como «Demo»; los borras con **Eliminar datos de demo**).

Además del navegador necesitas una cuenta en [Google Flow](https://labs.google/fx/tools/flow): ahí se generan los clips.

---


## Paso 1. Encontrar qué está explotando
<img width="552" height="577" alt="{BB7366DB-1CC9-4AC1-A926-8C9D8A4FAAC2}" src="https://github.com/user-attachments/assets/e3d622e5-a4f3-43c9-9caa-9496aff2473a" />

La app tiene tres pestañas: **Nichos**, **Videos** y **Proyectos**.

1. Pulsa **Escanear YouTube** y elige qué escanear:
   - **Tendencias**: casi no gasta cuota. Úsalo a diario.
   - **Por nicho o palabra clave**: más preciso, pero cada búsqueda cuesta 100 unidades de las 10.000 diarias. El diálogo te muestra el costo estimado antes de ejecutar.
   - **Los más recientes**: útil para medir las primeras horas de un video. Repítelo un par de veces al día: con dos escaneos separados por horas, la velocidad pasa de estimada a medida.
2. En **Nichos** verás un ranking por «calor». Un nicho caliente con mucha oportunidad (canales pequeños que explotaron) es el más fácil de replicar. Pulsa **Ver videos** para entrar a uno.
3. En **Videos** filtra por nicho, formato (cortos o largos), fecha y puntaje mínimo, y ordena por puntaje viral.
4. Cada tarjeta tiene un puntaje de 0 a 100. **Cómo se calculó** muestra el desglose: velocidad, rendimiento frente a su canal, interacción y alcance. Busca videos con puntaje alto **y** canal pequeño: demuestran que el formato funciona sin depender de una audiencia grande.

## Paso 2. Crear el proyecto
<img width="385" height="548" alt="{BC6AA16A-ADDF-4E99-A8D0-4DC424E64197}" src="https://github.com/user-attachments/assets/0b03b5af-d425-44bd-a525-b149e0e58573" />

En la tarjeta del video que quieres copiar, pulsa **Crear proyecto**:

- Ponle nombre (se usa para las carpetas y el archivo final).
- Marca las **plataformas de destino**: TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, Instagram Feed (4:5) o YouTube horizontal. Cada una genera su propio mp4 con el tamaño y las zonas seguras de esa app.

Ábrelo desde **Proyectos → Abrir proyecto**. Arriba verás la etapa actual; todo lo que se genere se guarda en la carpeta del proyecto (`workspace/<proyecto>/`).

## Paso 3. Analizar el video: el gancho y el estilo
<img width="688" height="586" alt="{05785BE7-8B0E-40F3-BA0F-0A37D7455E2D}" src="https://github.com/user-attachments/assets/7ec3a33c-6d91-4a24-8d1b-338b6a0c5ac5" />

En **Análisis del video de referencia** elige cómo analizar:

- **Que Gemini vea el video (recomendado):** detecta ritmo, planos, voz y transcripción. Solo funciona con videos públicos de YouTube.
- **Solo título y descripción:** más rápido, pero deduce el estilo sin verlo.

Pulsa **Analizar video**. El resultado tiene:

- **La fórmula para replicar:** el patrón del video en una frase.
- **El gancho:** lo más importante. Qué se ve y se dice en los primeros segundos, qué rompe el scroll, por qué el espectador no desliza y una **plantilla reutilizable** con huecos para tu tema.
- **Estructura:** línea de tiempo con las partes del video.
- **Perfil de estilo:** cámara, color, luz, cortes, subtítulos, voz y música. Es lo que se copiará.

Léelo antes de seguir. Si el gancho no te convence, vuelve a elegir otro video: es más barato que arreglar un mal punto de partida.

## Paso 4. Guion y prompts para Flow
<img width="1225" height="583" alt="{2F1C809B-ADFD-42B3-B0F6-DF8FE00E02ED}" src="https://github.com/user-attachments/assets/68e72dde-2c4d-47eb-9dc3-00e7a0fb3c11" />

1. Escribe **tu tema** (por ejemplo: «cómo retomar el gimnasio después de vacaciones»). La app aplica la mecánica del gancho original a tu tema, sin copiar sus palabras.
2. Elige idioma, duración total, tono y formato. Pulsa **Generar guion y prompts**.
3. Revisa el guion. Cada escena tiene voz en off, texto en pantalla, duración y un **prompt visual** para Flow.
   - Edita lo que quieras; los prompts se actualizan.
   - **Ganchos alternativos:** hay 3 variantes de la escena 1. **Usar este gancho** reemplaza la escena actual.
   - El contador avisa si la voz en off es demasiado larga para la duración de la escena.
4. Copia el prompt de cada escena con su botón **Copiar**. También quedan guardados como archivos en `03-prompts-flow/`.

## Paso 5. Generar los clips en Flow

Este paso es manual (Flow no tiene API gratuita):

1. Abre [Google Flow](https://labs.google/fx/tools/flow).
2. Pega el prompt de la escena 1, genera, y descarga el clip que más te guste. Repite por cada escena.
3. Cada clip debe durar entre 2 y 8 s y salir **sin voz, sin música y sin texto** (los prompts ya lo piden): eso lo pone la app después.
4. Si Flow te da un clip vertical y tu formato es horizontal (o al revés), la app recorta el centro; mejor genera con la orientación correcta.

## Paso 6. Subir los clips y generar el video
<img width="969" height="498" alt="{18C24DCF-A91A-4C4C-9AFD-F5161993E58A}" src="https://github.com/user-attachments/assets/ccc052e6-653b-471b-a4ce-465003bd2928" />
<img width="976" height="403" alt="{02F7EEC4-464F-420D-BA66-337D3DBCA8FF}" src="https://github.com/user-attachments/assets/63e3a30d-4bf0-4620-8e08-f9fd15fbb2af" />

En **Clips y video final**:

1. **Sube cada clip** arrastrándolo a su escena (o haciendo clic). Verás miniatura, duración y resolución. Los avisos amarillos señalan clips cortos o con orientación distinta. Para cambiar uno, **Reemplazar**; para quitarlo, **Quitar**.
2. Configura la edición:
   - **Voz en off:** elige una voz de Gemini y pulsa **Probar voz** para oírla. La velocidad ajusta el ritmo. Con «Voz de Gemini» desactivada, el video queda sin narración.
   - **Subtítulos:** estilo (blanco con borde, amarillo o con caja), posición y mayúsculas. Vienen preseleccionados según los subtítulos del video de referencia.
   - **Sonido:** conserva el ambiente de los clips a volumen bajo y, si quieres, suma **música de fondo** subiendo tu propia pista (mp3, wav o m4a; usa música con licencia para publicar).
   - **Formatos de salida:** marca las plataformas que necesitas.
3. Cuando estén todos los clips, **Generar video**. Verás el avance por escena; puedes **Cancelar** o salir de la pantalla, porque el trabajo sigue en el servidor. Solo se genera un video a la vez.
4. Al terminar aparecen los videos para verlos y **Descargar mp4**. También quedan en `07-exportados/<formato>/`.

Si algo no te gusta, cambia las opciones y pulsa **Generar de nuevo**. La voz de cada escena se reutiliza mientras no cambies su texto ni la voz elegida, así que repetir no gasta cuota de Gemini.

---

## Carpetas de cada proyecto

```
workspace/<proyecto>/
├── 00-referencia/       datos del video original
├── 01-analisis/         análisis (json y resumen legible)
├── 02-guion/            guion (json y legible)
├── 03-prompts-flow/     un .txt por escena y prompts.md
├── 04-clips/            los clips que subiste
├── 05-voz-y-musica/     voz de cada escena y tu pista de música
├── 06-subtitulos/
└── 07-exportados/       un mp4 por plataforma
```

## Problemas frecuentes

| Qué ves | Qué hacer |
|---|---|
| «Falta GEMINI_API_KEY» | Agrégala a `.env` y reinicia el servidor. Sin ella puedes generar el video **sin voz en off**. |
| «Gemini limita las peticiones» | Es el límite del plan gratuito. La app espera y reintenta sola; si persiste, espera un minuto. |
| «Ya hay una generación en curso» | Espera a que termine la anterior de ese proyecto. |
| «Ya se está generando un video» | Solo se edita un video a la vez; espera o cancela el que está en curso. |
| Error al subir un clip | Debe ser un video real (.mp4, .mov, .webm, .mkv) de menos de 600 MB. |
| La voz falla con error de modelo | El nombre del modelo de voz puede haber cambiado: ajusta `GEMINI_TTS_MODEL` en `.env`. |
| Se acabó la cuota de YouTube | Se reinicia a medianoche, hora del Pacífico. Mientras tanto, trabaja con los videos ya guardados. |
| No encuentro FFmpeg | Viene incluido (`ffmpeg-static`); si falla en tu sistema, instala FFmpeg y pon su ruta en `FFMPEG_PATH`. |

## Buenas prácticas

- **Copia la mecánica, no el contenido.** La app reescribe el gancho para tu tema; no subas clips ni textos calcados del video original.
- **Gasta cuota con cabeza:** tendencias a diario, búsquedas por nicho solo cuando estés decidiendo.
- **Prueba la voz** antes de generar: es lo que más cambia el resultado final.
- **Revisa el video antes de publicar**, sobre todo los subtítulos: se reparten según el largo del texto de cada escena y pueden desfasarse unas décimas de segundo.

