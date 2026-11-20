import { z } from 'zod';
import { FORMAT_IDS } from './formats.js';

// Los modelos de lenguaje a veces omiten o malforman campos secundarios. Los campos de apoyo
// se leen con `.catch(...)` para no tirar un resultado bueno por un detalle; los esenciales
// (escenas, prompt visual, resumen) sí son obligatorios.
const text = () => z.string().catch('');
const num = () => z.coerce.number().catch(0);
const list = () => z.array(z.string()).catch([]);

export const analysisSchema = z.object({
  summary: z.string().min(1),
  language: text(),
  hook: z.object({ text: text(), technique: text(), seconds: num() }).catch({ text: '', technique: '', seconds: 0 }),
  structure: z
    .array(z.object({ startS: num(), endS: num(), label: text(), description: text() }))
    .min(1)
    .max(15),
  pacing: text(),
  visualStyle: z
    .object({ description: text(), shotTypes: list(), palette: list(), textOnScreen: text() })
    .catch({ description: '', shotTypes: [], palette: [], textOnScreen: '' }),
  audio: z.object({ voice: text(), music: text(), soundEffects: text() }).catch({ voice: '', music: '', soundEffects: '' }),
  hookDetail: z
    .object({
      visual: text(),
      spoken: text(),
      onScreenText: text(),
      audio: text(),
      technique: text(),
      patternInterrupt: text(),
      whyItStops: text(),
      seconds: num(),
      template: text(),
    })
    .catch({ visual: '', spoken: '', onScreenText: '', audio: '', technique: '', patternInterrupt: '', whyItStops: '', seconds: 0, template: '' }),
  styleProfile: z
    .object({
      look: text(),
      colorGrading: text(),
      camera: text(),
      lighting: text(),
      setting: text(),
      editing: z
        .object({ avgShotLengthS: num(), cuts: text(), transitions: text(), effects: text() })
        .catch({ avgShotLengthS: 0, cuts: '', transitions: '', effects: '' }),
      captions: z
        .object({
          present: z.boolean().catch(false),
          preset: z.enum(['classic', 'yellow', 'boxed']).catch('classic'),
          position: z.enum(['bottom', 'center', 'top']).catch('bottom'),
          uppercase: z.boolean().catch(true),
          description: text(),
        })
        .catch({ present: false, preset: 'classic', position: 'bottom', uppercase: true, description: '' }),
      voice: z.object({ description: text(), pace: text() }).catch({ description: '', pace: '' }),
      music: text(),
    })
    .catch({
      look: '',
      colorGrading: '',
      camera: '',
      lighting: '',
      setting: '',
      editing: { avgShotLengthS: 0, cuts: '', transitions: '', effects: '' },
      captions: { present: false, preset: 'classic', position: 'bottom', uppercase: true, description: '' },
      voice: { description: '', pace: '' },
      music: '',
    }),
  whyItWorks: list(),
  formula: text(),
  transcript: z.string().nullable().catch(null),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const sceneSchema = z.object({
  durationS: num(),
  voiceover: text(),
  onScreenText: text(),
  visualPrompt: z.string().min(5),
  audioPrompt: text(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const scriptSchema = z.object({
  title: z.string().min(1),
  concept: text(),
  language: text(),
  hook: text(),
  alternativeHooks: z
    .array(z.object({ voiceover: text(), onScreenText: text(), visualPrompt: text(), technique: text() }))
    .max(5)
    .catch([]),
  styleBible: text(),
  scenes: z.array(sceneSchema).min(1).max(14),
  caption: text(),
  hashtags: list(),
  musicSuggestion: text(),
});
export type ScriptData = z.infer<typeof scriptSchema>;

export const MAX_SCENE_SECONDS = 8;
export const MIN_SCENE_SECONDS = 2;

export const scriptParamsSchema = z.object({
  topic: z.string().trim().max(600).optional(),
  language: z.enum(['es', 'en', 'pt']).default('es'),
  targetSeconds: z.number().int().min(10).max(90).default(30),
  formatId: z.enum(FORMAT_IDS as [string, ...string[]]).optional(),
  promptLanguage: z.enum(['en', 'es']).default('en'),
  tone: z.string().trim().max(80).optional(),
});
export type ScriptParams = z.infer<typeof scriptParamsSchema>;

const sceneEdit = z.object({
  n: z.number().int().min(1).max(14),
  voiceover: z.string().max(1500).optional(),
  onScreenText: z.string().max(300).optional(),
  visualPrompt: z.string().trim().min(5).max(3000).optional(),
  audioPrompt: z.string().max(600).optional(),
  durationS: z.number().min(MIN_SCENE_SECONDS).max(MAX_SCENE_SECONDS).optional(),
});

export const scriptPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  styleBible: z.string().max(2000).optional(),
  caption: z.string().max(500).optional(),
  hashtags: z.array(z.string().max(40)).max(15).optional(),
  scenes: z.array(sceneEdit).max(14).optional(),
});
export type ScriptPatch = z.infer<typeof scriptPatchSchema>;
