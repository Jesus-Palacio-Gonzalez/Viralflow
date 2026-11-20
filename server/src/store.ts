import { db } from './db.js';
import type { RawChannel, RawVideo } from './types.js';

const upsertChannel = db.prepare(`
  INSERT INTO channels (id, title, subscribers, video_count, view_count, updated_at)
  VALUES (@id, @title, @subscribers, @videoCount, @viewCount, @now)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    subscribers = excluded.subscribers,
    video_count = excluded.video_count,
    view_count = excluded.view_count,
    updated_at = excluded.updated_at
`);

const upsertVideo = db.prepare(`
  INSERT INTO videos (id, channel_id, title, description, thumbnail, published_at, duration_s, category_id, tags,
                      language, views, likes, comments, source, first_seen_at, updated_at)
  VALUES (@id, @channelId, @title, @description, @thumbnail, @publishedAt, @durationS, @categoryId, @tags,
          @language, @views, @likes, @comments, @source, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    thumbnail = excluded.thumbnail,
    duration_s = excluded.duration_s,
    category_id = excluded.category_id,
    tags = excluded.tags,
    language = excluded.language,
    views = excluded.views,
    likes = excluded.likes,
    comments = excluded.comments,
    updated_at = excluded.updated_at
`);

const hasVideo = db.prepare('SELECT 1 FROM videos WHERE id = ?');
const insertSnapshot = db.prepare(
  'INSERT OR IGNORE INTO video_snapshots (video_id, taken_at, views, likes, comments) VALUES (?, ?, ?, ?, ?)',
);
const linkNiche = db.prepare('INSERT OR IGNORE INTO video_niches (video_id, niche_id) VALUES (?, ?)');

export interface StoredVideo {
  raw: RawVideo;
  nicheIds: number[];
}

/**
 * Guarda canales, videos, un snapshot de estadísticas por video y los vínculos con nichos.
 * Cada llamada agrega un snapshot nuevo; con dos o más se puede medir el crecimiento real.
 */
export function saveBatch(
  videos: StoredVideo[],
  channels: RawChannel[],
  source: 'youtube' | 'demo',
  takenAt: Date = new Date(),
): { inserted: number; updated: number } {
  const now = takenAt.toISOString();
  let inserted = 0;
  let updated = 0;

  db.transaction(() => {
    for (const c of channels) {
      upsertChannel.run({
        id: c.id,
        title: c.title,
        subscribers: c.subscribers,
        videoCount: c.videoCount,
        viewCount: c.viewCount,
        now,
      });
    }
    for (const { raw, nicheIds } of videos) {
      if (hasVideo.get(raw.id)) updated++;
      else inserted++;
      upsertVideo.run({
        id: raw.id,
        channelId: raw.channelId,
        title: raw.title,
        description: raw.description,
        thumbnail: raw.thumbnail,
        publishedAt: new Date(raw.publishedAt).toISOString(),
        durationS: raw.durationS,
        categoryId: raw.categoryId,
        tags: JSON.stringify(raw.tags),
        language: raw.language,
        views: raw.views,
        likes: raw.likes,
        comments: raw.comments,
        source,
        now,
      });
      insertSnapshot.run(raw.id, now, raw.views, raw.likes, raw.comments);
      for (const nicheId of nicheIds) linkNiche.run(raw.id, nicheId);
    }
  })();

  return { inserted, updated };
}
