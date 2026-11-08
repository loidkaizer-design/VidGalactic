/**
 * VidGalactic API Server
 * ----------------------
 * Endpoints:
 *   GET /e/movie/:tmdb_id      -> Movie aggregates (title, backdrop, stream_urls, file_name, default_subs)
 *   GET /e/tv/:tmdb_id         -> TV series aggregates (seasons, episodes, stream_urls per episode)
 *   GET /src/sub/:tmdb_id      -> List of subtitle tracks for a TMDB ID
 *   GET /src/webvtt/:subtitle_id -> WebVTT subtitle content (SRT converted to VTT)
 *
 * Proxies vaplayer.ru streamdata API and converts subtitles to WebVTT.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---- configuration ---- */
const VAPLAYER_API = 'https://streamdata.vaplayer.ru/api.php';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DEFAULT_REFERER = 'https://nextgencloudfabric.com/';

/* ---- middleware ---- */
app.use(helmet());
app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  next();
});

app.options('*', (_req, res) => res.sendStatus(204));

/* ---- helpers ---- */
function vaplayerHeaders() {
  return {
    'User-Agent': UA,
    'Referer': DEFAULT_REFERER,
    'Origin': DEFAULT_REFERER.replace(/\/+$/, ''),
    'Accept': 'application/json',
  };
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
  return res.json();
}

function normalizeSubtitle(sub) {
  return {
    id: sub.id || sub.url || '',
    code: sub.code || sub.lang || 'und',
    lang: sub.lang || sub.code || 'und',
    name: sub.name || sub.code || sub.lang || 'Subtitle',
    url: sub.url || '',
  };
}

function srtToVtt(srt) {
  if (!srt) return 'WEBVTT\n\n';
  let text = srt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.trim().startsWith('WEBVTT')) return text;
  const lines = text.split('\n');
  const out = ['WEBVTT', ''];
  for (const line of lines) {
    if (/^\s*\d+\s*$/.test(line)) continue; // drop subtitle index numbers
    if (line.includes('-->')) {
      // convert timestamps: 00:00:00,000 -> 00:00:00.000
      text = line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      out.push(text);
    } else {
      out.push(line);
    }
  }
  return out.join('\n').trim() + '\n';
}

/* ============================================================
   ENDPOINTS
   ============================================================ */

/**
 * GET /e/movie/:tmdb_id
 * Returns movie aggregates from vaplayer API.
 */
app.get('/e/movie/:tmdb_id', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    if (!/^\d+$/.test(tmdb_id)) {
      return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
    }

    const url = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=movie`;
    const json = await fetchJson(url, vaplayerHeaders());

    if (json.status_code && String(json.status_code) !== '200') {
      return res.status(502).json({ success: false, error: json.error || `API error ${json.status_code}` });
    }

    const data = json.data || {};
    const stream_urls = Array.isArray(data.stream_urls) ? data.stream_urls : [];
    const default_subs = Array.isArray(json.default_subs) ? json.default_subs.map(normalizeSubtitle) : [];

    return res.json({
      success: true,
      type: 'movie',
      tmdb_id,
      title: data.title || 'Unknown Movie',
      imdb_id: data.imdb_id || null,
      file_name: data.file_name || '',
      backdrop: data.backdrop || null,
      thumbnails_url: data.thumbnails_url || null,
      stream_urls,
      default_subs,
      server_count: stream_urls.length,
      subtitle_count: default_subs.length,
    });
  } catch (err) {
    console.error('[/e/movie/:tmdb_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch movie data.' });
  }
});

/**
 * GET /e/tv/:tmdb_id
 * Returns TV series aggregates. Optionally accepts ?season=N&episode=N
 * to fetch a specific episode's streams.
 */
app.get('/e/tv/:tmdb_id', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    const { season, episode } = req.query;

    if (!/^\d+$/.test(tmdb_id)) {
      return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
    }

    let url = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=tv`;
    if (season) url += `&season=${encodeURIComponent(season)}`;
    if (episode) url += `&episode=${encodeURIComponent(episode)}`;

    const json = await fetchJson(url, vaplayerHeaders());

    if (json.status_code && String(json.status_code) !== '200') {
      return res.status(502).json({ success: false, error: json.error || `API error ${json.status_code}` });
    }

    const data = json.data || {};
    const stream_urls = Array.isArray(data.stream_urls) ? data.stream_urls : [];
    const default_subs = Array.isArray(json.default_subs) ? json.default_subs.map(normalizeSubtitle) : [];
    const eps = data.eps || {}; // { "1": [1,2,3], "2": [1,2] }

    // Build flat episode list from eps map
    const allEpisodes = [];
    const seasonKeys = Object.keys(eps).map(Number).sort((a, b) => a - b);
    seasonKeys.forEach((s) => {
      (eps[s] || []).forEach((e) => {
        allEpisodes.push({ s, e });
      });
    });

    return res.json({
      success: true,
      type: 'tv',
      tmdb_id,
      title: data.title || 'Unknown Series',
      imdb_id: data.imdb_id || null,
      file_name: data.file_name || '',
      backdrop: data.backdrop || null,
      thumbnails_url: data.thumbnails_url || null,
      stream_urls,
      default_subs,
      eps,
      seasons: seasonKeys,
      episodes: allEpisodes,
      season_count: seasonKeys.length,
      episode_count: allEpisodes.length,
      server_count: stream_urls.length,
      subtitle_count: default_subs.length,
      current_season: season ? parseInt(season, 10) : null,
      current_episode: episode ? parseInt(episode, 10) : null,
    });
  } catch (err) {
    console.error('[/e/tv/:tmdb_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch TV data.' });
  }
});

/**
 * GET /src/sub/:tmdb_id
 * Returns the list of available subtitle tracks for a TMDB ID.
 * Fetches movie data from vaplayer and extracts default_subs.
 */
app.get('/src/sub/:tmdb_id', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    if (!/^\d+$/.test(tmdb_id)) {
      return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
    }

    const url = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=movie`;
    const json = await fetchJson(url, vaplayerHeaders());

    if (json.status_code && String(json.status_code) !== '200') {
      return res.status(502).json({ success: false, error: json.error || `API error ${json.status_code}` });
    }

    const rawSubs = Array.isArray(json.default_subs) ? json.default_subs : [];
    const subs = rawSubs.map((sub, idx) => normalizeSubtitle({ ...sub, id: idx }));

    return res.json({
      success: true,
      tmdb_id,
      subtitle_count: subs.length,
      subtitles: subs,
    });
  } catch (err) {
    console.error('[/src/sub/:tmdb_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch subtitles.' });
  }
});

/**
 * GET /src/webvtt/:subtitle_id
 * Fetches a subtitle URL and converts SRT to WebVTT.
 * Query: ?url=<subtitle_url>  (full subtitle URL)
 * OR     :param is a numeric index resolved against /src/sub cache (simplest: pass ?url=)
 *
 * The subtitle_id param can be:
 *   - a numeric index (requires prior /src/sub call to map) — we accept ?url= directly
 *   - or the client passes ?url=<encoded subtitle url>
 *
 * Returns Content-Type: text/vtt
 */
app.get('/src/webvtt/:subtitle_id', async (req, res) => {
  try {
    const { subtitle_id } = req.params;
    const { url: subUrl } = req.query;

    let targetUrl = subUrl;

    // If no url query, try to interpret subtitle_id as an index —
    // we can't resolve without a tmdb context, so require ?url=
    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing ?url=<subtitle_url> query parameter.',
        usage: 'GET /src/webvtt/:subtitle_id?url=https://example.com/subtitle.srt',
      });
    }

    // Decode if it was passed encoded
    try {
      targetUrl = decodeURIComponent(targetUrl);
    } catch (e) { /* use as-is */ }

    const subRes = await fetch(targetUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });

    if (!subRes.ok) {
      return res.status(502).json({ success: false, error: `Subtitle source returned ${subRes.status}` });
    }

    const raw = await subRes.text();
    const vtt = srtToVtt(raw);

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    return res.send(vtt);
  } catch (err) {
    console.error('[/src/webvtt/:subtitle_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch subtitle.' });
  }
});

/* ---- health ---- */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vidgalactic-api', time: new Date().toISOString() });
});

/* ---- root ---- */
app.get('/', (_req, res) => {
  res.json({
    service: 'VidGalactic API',
    version: '1.0.0',
    endpoints: {
      'GET /e/movie/:tmdb_id': 'Movie aggregates (title, backdrop, stream_urls, default_subs)',
      'GET /e/tv/:tmdb_id': 'TV series aggregates (seasons, episodes, stream_urls)',
      'GET /src/sub/:tmdb_id': 'List available subtitle tracks',
      'GET /src/webvtt/:subtitle_id?url=...': 'Fetch and convert subtitle to WebVTT',
      'GET /health': 'Health check',
    },
  });
});

/* ---- start (local dev) ---- */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`VidGalactic API listening on http://localhost:${PORT}`);
    console.log(`  GET /e/movie/:tmdb_id   -> Movie aggregates`);
    console.log(`  GET /e/tv/:tmdb_id      -> TV series aggregates`);
    console.log(`  GET /src/sub/:tmdb_id   -> Subtitle track list`);
    console.log(`  GET /src/webvtt/:id     -> WebVTT subtitle content`);
  });
}

/* ---- Vercel serverless handler ---- */
module.exports = app;
