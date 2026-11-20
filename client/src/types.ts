// Espejo de los tipos del servidor (server/src/types.ts y routes). Mantenerlos sincronizados.

export interface ScoreMetrics {
  score: number;
  velocity: number;
  outlier: number | null;
  engagement: number | null;
  reach: number;
  ageHours: number;
  vph: number;
  effectiveVph: number;
  ratio: number | null;
  engagementRate: number | null;
}

export interface Video {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  durationS: number;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  language: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  channelId: string;
  channelTitle: string;
  subscribers: number | null;
  source: 'youtube' | 'demo';
  niches: number[];
  growthVph: number | null;
  metrics: ScoreMetrics;
}

export interface Niche {
  id: number;
  slug: string;
  name: string;
  query: string;
  builtin: boolean;
  videos: number;
  channels: number;
  avgScore: number;
  topScore: number;
  avgVph: number;
  smallChannelWins: number;
  opportunity: number;
  nicheScore: number;
  lowSample: boolean;
  topVideoId: string | null;
}

export interface Term {
  term: string;
  videos: number;
  channels: number;
  avgScore: number;
}

export interface FormatPreset {
  id: string;
  label: string;
  platform: string;
  aspect: '9:16' | '16:9' | '4:5' | '1:1';
  width: number;
  height: number;
  fps: number;
  recommendedSeconds: { min: number; max: number };
  notes: string[];
}

export interface Stage {
  id: string;
  folder: string;
  label: string;
}

export interface Catalog {
  categories: Array<{ id: string; name: string }>;
  defaultTrendingCategories: string[];
  stages: Stage[];
}

export interface Status {
  apiKeyConfigured: boolean;
  aiConfigured: boolean;
  aiModel: string;
  quota: { day: string; used: number; limit: number; remaining: number };
  workspaceDir: string;
  totalVideos: number;
  demoVideos: number;
  scanRunning: boolean;
}

export interface Project {
  id: number;
  slug: string;
  name: string;
  videoId: string | null;
  nicheId: number | null;
  platforms: string[];
  stage: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  folderExists: boolean;
  reference: { title: string; thumbnail: string; url: string; channelTitle: string; source: 'youtube' | 'demo' } | null;
}

// ───────────── Fase 2: análisis, guion y prompts ─────────────

export type AnalysisMode = 'video' | 'metadata';

export interface Analysis {
  summary: string;
  language: string;
  hook: { text: string; technique: string; seconds: number };
  structure: Array<{ startS: number; endS: number; label: string; description: string }>;
  pacing: string;
  visualStyle: { description: string; shotTypes: string[]; palette: string[]; textOnScreen: string };
  audio: { voice: string; music: string; soundEffects: string };
  hookDetail: {
    visual: string;
    spoken: string;
    onScreenText: string;
    audio: string;
    technique: string;
    patternInterrupt: string;
    whyItStops: string;
    seconds: number;
    template: string;
  };
  styleProfile: {
    look: string;
    colorGrading: string;
    camera: string;
    lighting: string;
    setting: string;
    editing: { avgShotLengthS: number; cuts: string; transitions: string; effects: string };
    captions: { present: boolean; preset: CaptionPreset; position: CaptionPosition; uppercase: boolean; description: string };
    voice: { description: string; pace: string };
    music: string;
  };
  whyItWorks: string[];
  formula: string;
  transcript: string | null;
}

export type CaptionPreset = 'classic' | 'yellow' | 'boxed';
export type CaptionPosition = 'bottom' | 'center' | 'top';

export interface AnalysisDTO {
  mode: AnalysisMode;
  model: string;
  createdAt: string;
  data: Analysis;
}

export interface Scene {
  n: number;
  durationS: number;
  voiceover: string;
  onScreenText: string;
  visualPrompt: string;
  audioPrompt: string;
  /** Prompt final (escena + estilo común + formato), listo para pegar en Flow. */
  flowPrompt: string;
}

export interface ScriptParams {
  topic?: string;
  language: 'es' | 'en' | 'pt';
  targetSeconds: number;
  formatId?: string;
  promptLanguage: 'en' | 'es';
  tone?: string;
}

export interface ScriptDTO {
  params: ScriptParams & { aspect: '9:16' | '16:9'; platformLabel: string | null };
  model: string;
  createdAt: string;
  updatedAt: string;
  totalS: number;
  data: {
    title: string;
    concept: string;
    language: string;
    hook: string;
    alternativeHooks: Array<{ voiceover: string; onScreenText: string; visualPrompt: string; technique: string }>;
    styleBible: string;
    scenes: Scene[];
    caption: string;
    hashtags: string[];
    musicSuggestion: string;
  };
}

export interface ScriptPatch {
  title?: string;
  styleBible?: string;
  caption?: string;
  hashtags?: string[];
  scenes?: Array<{ n: number; voiceover?: string; onScreenText?: string; visualPrompt?: string; audioPrompt?: string; durationS?: number }>;
}

export interface Clip {
  n: number;
  fileName: string;
  originalName: string;
  durationS: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
  uploadedAt: string;
  thumbUrl: string;
}

export interface Music {
  fileName: string;
  originalName: string;
  durationS: number;
  sizeBytes: number;
  uploadedAt: string;
}

export interface RenderOptions {
  voice: { mode: 'gemini' | 'none'; voiceName: string; pace: number };
  captions: { enabled: boolean; preset: CaptionPreset; position: CaptionPosition; uppercase: boolean };
  music: boolean;
  keepClipAudio: boolean;
  formatIds: string[];
}

export interface RenderOutput {
  formatId: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  durationS: number;
  width: number;
  height: number;
  url: string;
}

export interface RenderState {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  step: string;
  progress: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  options: RenderOptions | null;
  outputs: RenderOutput[];
}

export interface VoiceOption {
  id: string;
  label: string;
}

export interface ProjectContent {
  analysis: AnalysisDTO | null;
  script: ScriptDTO | null;
  clips: Clip[];
  music: Music | null;
  render: RenderState;
  voices: VoiceOption[];
}

export interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
}

export type ScanMode = 'niches' | 'trending' | 'keyword';

export interface ScanParams {
  mode: ScanMode;
  nicheIds?: number[];
  query?: string;
  regionCode: string;
  language: string;
  publishedWithinDays: number;
  duration: 'short' | 'any';
  order: 'viewCount' | 'date' | 'relevance';
  pages: number;
  categoryIds?: string[];
}

export interface ScanSummary {
  scanId: number;
  found: number;
  inserted: number;
  updated: number;
  unitsUsed: number;
  warning?: string;
}

export type SortKey = 'score' | 'vph' | 'views' | 'ratio' | 'recent' | 'growth';

export interface VideoFilters {
  days: number;
  nicheId?: number;
  duration: 'short' | 'any';
  minScore: number;
  q?: string;
  sort: SortKey;
  limit: number;
}
