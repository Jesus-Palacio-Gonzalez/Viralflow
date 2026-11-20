import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNicheStats, computeTrendingTerms, isSmallChannelWin } from './analytics.js';
import { scoreVideo } from './scoring.js';
import type { NicheRow, VideoDTO } from './types.js';
import { parseDuration, slugify } from './util.js';

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

test('parseDuration entiende duraciones ISO 8601', () => {
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(parseDuration('PT1M30S'), 90);
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('P0D'), 0);
  assert.equal(parseDuration('basura'), 0);
});

test('slugify quita acentos y símbolos', () => {
  assert.equal(slugify('Motivación y Éxito!!'), 'motivacion-y-exito');
  assert.equal(slugify('???'), 'item');
});

test('el puntaje sube con la velocidad y con superar al canal', () => {
  const base = { likes: 500, comments: 50, publishedAt: hoursAgo(10) };
  const slow = scoreVideo({ ...base, views: 1_000, subscribers: 100_000 });
  const fast = scoreVideo({ ...base, views: 200_000, subscribers: 100_000 });
  const outlier = scoreVideo({ ...base, views: 200_000, subscribers: 2_000 });
  assert.ok(fast.score > slow.score);
  assert.ok(outlier.score > fast.score);
  assert.equal(outlier.ratio, 100);
  assert.ok(outlier.score <= 100 && slow.score >= 0);
});

test('si faltan suscriptores o likes se reparte el peso en vez de penalizar', () => {
  const r = scoreVideo({ views: 50_000, likes: null, comments: null, subscribers: null, publishedAt: hoursAgo(5) });
  assert.equal(r.outlier, null);
  assert.equal(r.engagement, null);
  assert.ok(r.score > 0);
});

test('usa el crecimiento medido cuando existe', () => {
  const input = { views: 10_000, likes: 100, comments: 10, subscribers: 5_000, publishedAt: hoursAgo(100) };
  const lifetime = scoreVideo(input);
  const growing = scoreVideo({ ...input, growthVph: 5_000 });
  assert.ok(growing.velocity > lifetime.velocity);
  assert.equal(growing.effectiveVph, 5_000);
});

function video(id: string, channelId: string, nicheId: number, views: number, subs: number, title = 'video'): VideoDTO {
  const publishedAt = hoursAgo(24);
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    description: '',
    thumbnail: '',
    publishedAt,
    durationS: 30,
    categoryId: null,
    categoryName: null,
    tags: [],
    language: 'es',
    views,
    likes: Math.round(views * 0.05),
    comments: Math.round(views * 0.002),
    channelId,
    channelTitle: channelId,
    subscribers: subs,
    source: 'youtube',
    niches: [nicheId],
    growthVph: null,
    metrics: scoreVideo({
      views,
      likes: Math.round(views * 0.05),
      comments: Math.round(views * 0.002),
      subscribers: subs,
      publishedAt,
    }),
  };
}

test('isSmallChannelWin exige canal pequeño, 3× su tamaño y vistas mínimas', () => {
  assert.equal(isSmallChannelWin(video('a', 'c', 1, 50_000, 5_000)), true);
  assert.equal(isSmallChannelWin(video('b', 'c', 1, 50_000, 500_000)), false);
  assert.equal(isSmallChannelWin(video('c', 'c', 1, 6_000, 1_000)), false);
});

test('el ranking de nichos premia picos altos y oportunidad para canales pequeños', () => {
  const niches: NicheRow[] = [
    { id: 1, slug: 'a', name: 'Caliente', query: 'a', builtin: true },
    { id: 2, slug: 'b', name: 'Frío', query: 'b', builtin: true },
    { id: 3, slug: 'c', name: 'Vacío', query: 'c', builtin: true },
  ];
  const videos = [
    ...[0, 1, 2, 3, 4, 5].map((i) => video(`h${i}`, `ch${i % 4}`, 1, 400_000, 8_000)),
    ...[0, 1, 2, 3, 4, 5].map((i) => video(`f${i}`, `cf${i % 4}`, 2, 900, 800_000)),
  ];
  const stats = computeNicheStats(videos, niches);
  assert.equal(stats[0]!.name, 'Caliente');
  assert.equal(stats[0]!.opportunity, 100);
  assert.equal(stats[0]!.lowSample, false);
  assert.equal(stats.at(-1)!.name, 'Vacío');
  assert.equal(stats.at(-1)!.videos, 0);
});

test('los términos en alza requieren varios videos y varios canales', () => {
  const titles = ['Misterio resuelto', 'Misterio en el bosque', 'Gran misterio', 'Otra cosa distinta'];
  const videos = titles.map((t, i) => video(`t${i}`, `canal${i}`, 1, 100_000, 10_000, t));
  const terms = computeTrendingTerms(videos).map((t) => t.term);
  assert.ok(terms.includes('misterio'));
  assert.ok(!terms.includes('bosque'));
});
