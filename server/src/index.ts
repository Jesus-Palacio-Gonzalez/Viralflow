import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config, ROOT } from './config.js';
import './db.js';
import { AppError } from './errors.js';
import { api } from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', api);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
});

// En producción el servidor también sirve el cliente compilado.
const clientDist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET') res.sendFile(path.join(clientDist, 'index.html'));
    else next();
  });
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Datos inválidos — ${message}` } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'El cuerpo de la petición no es JSON válido.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor.' } });
};
app.use(onError);

app.listen(config.port, () => {
  console.log(`ViralFlow API en http://localhost:${config.port}`);
  console.log(config.youtubeApiKey ? 'YouTube API key: configurada' : 'YouTube API key: NO configurada (usa datos de demo o agrega YOUTUBE_API_KEY al .env)');
  console.log(`Proyectos en: ${config.workspaceDir}`);
});
