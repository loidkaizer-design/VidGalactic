/**
 * VidGalactic API Server
 * ----------------------
 * Endpoints:
 *   GET /e/movie/:tmdb_id      -> HTML embed player (browser) OR JSON (API call with Accept: application/json)
 *   GET /e/tv/:tmdb_id         -> HTML embed player (browser) OR JSON (API call with Accept: application/json)
 *   GET /src/sub/:tmdb_id      -> List of subtitle tracks via OpenSubtitles (imdbid lookup)
 *   GET /src/webvtt/:subtitle_id -> WebVTT subtitle content from stellarconductornexus CDN
 *
 * Proxies vaplayer.ru streamdata API + OpenSubtitles + stellarconductornexus subtitle CDN.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---- configuration ---- */
const VAPLAYER_API = 'https://streamdata.vaplayer.ru/api.php';
const OPENSUB_SEARCH = 'https://rest.opensubtitles.org/search';
const SUB_VTT_CDN = 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19';
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
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`Upstream returned non-JSON: ${res.status}`); }
}

async function fetchText(url, headers) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
  return res.text();
}

function numericImdbId(imdbId) {
  return String(imdbId || '').replace(/^tt/i, '');
}

/* ---- read embed HTML files ---- */
const EMBED_MOVIE_HTML = fs.readFileSync(path.join(__dirname, 'public/embed-movie.html'), 'utf8');
const EMBED_TV_HTML = fs.readFileSync(path.join(__dirname, 'public/embed-tv.html'), 'utf8');

function wantsHtml(req) {
  const accept = req.headers.accept || '';
  // Browser navigation requests include text/html; explicit API calls set Accept: application/json
  return accept.includes('text/html') && !accept.includes('application/json');
}

/* ============================================================
   EMBED PLAYER ROUTES (HTML for browsers, JSON for API)
   ============================================================ */

/**
 * GET /e/movie/:tmdb_id
 */
app.get('/e/movie/:tmdb_id', async (req, res) => {
  const { tmdb_id } = req.params;
  if (!/^\d+$/.test(tmdb_id)) {
    return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
  }

  if (wantsHtml(req)) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(EMBED_MOVIE_HTML);
  }

  // JSON API response
  try {
    const url = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=movie`;
    const json = await fetchJson(url, vaplayerHeaders());
    if (json.status_code && String(json.status_code) !== '200') {
      return res.status(502).json({ success: false, error: json.error || `API error ${json.status_code}` });
    }
    const data = json.data || {};
    const stream_urls = Array.isArray(data.stream_urls) ? data.stream_urls : [];
    const default_subs = Array.isArray(json.default_subs) ? json.default_subs.map((s) => ({
      id: s.id || s.url || '',
      code: s.code || s.lang || 'und',
      lang: s.lang || s.code || 'und',
      name: s.name || s.code || s.lang || 'Subtitle',
      url: s.url || '',
    })) : [];
    return res.json({
      success: true, type: 'movie', tmdb_id,
      title: data.title || 'Unknown Movie',
      imdb_id: data.imdb_id || null,
      file_name: data.file_name || '',
      backdrop: data.backdrop || null,
      thumbnails_url: data.thumbnails_url || null,
      stream_urls, default_subs,
      server_count: stream_urls.length, subtitle_count: default_subs.length,
    });
  } catch (err) {
    console.error('[/e/movie/:tmdb_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch movie data.' });
  }
});

/**
 * GET /e/tv/:tmdb_id
 */
app.get('/e/tv/:tmdb_id', async (req, res) => {
  const { tmdb_id } = req.params;
  const { season, episode } = req.query;
  if (!/^\d+$/.test(tmdb_id)) {
    return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
  }

  if (wantsHtml(req)) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(EMBED_TV_HTML);
  }

  // JSON API response
  try {
    let url = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=tv`;
    if (season) url += `&season=${encodeURIComponent(season)}`;
    if (episode) url += `&episode=${encodeURIComponent(episode)}`;
    const json = await fetchJson(url, vaplayerHeaders());
    if (json.status_code && String(json.status_code) !== '200') {
      return res.status(502).json({ success: false, error: json.error || `API error ${json.status_code}` });
    }
    const data = json.data || {};
    const stream_urls = Array.isArray(data.stream_urls) ? data.stream_urls : [];
    const default_subs = Array.isArray(json.default_subs) ? json.default_subs.map((s) => ({
      id: s.id || s.url || '',
      code: s.code || s.lang || 'und',
      lang: s.lang || s.code || 'und',
      name: s.name || s.code || s.lang || 'Subtitle',
      url: s.url || '',
    })) : [];
    const eps = data.eps || {};
    const allEpisodes = [];
    const seasonKeys = Object.keys(eps).map(Number).sort((a, b) => a - b);
    seasonKeys.forEach((s) => { (eps[s] || []).forEach((e) => { allEpisodes.push({ s, e }); }); });
    return res.json({
      success: true, type: 'tv', tmdb_id,
      title: data.title || 'Unknown Series',
      imdb_id: data.imdb_id || null,
      file_name: data.file_name || '',
      backdrop: data.backdrop || null,
      thumbnails_url: data.thumbnails_url || null,
      stream_urls, default_subs, eps,
      seasons: seasonKeys, episodes: allEpisodes,
      season_count: seasonKeys.length, episode_count: allEpisodes.length,
      server_count: stream_urls.length, subtitle_count: default_subs.length,
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
 * Subtitle tracks via OpenSubtitles REST API.
 */
app.get('/src/sub/:tmdb_id', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    if (!/^\d+$/.test(tmdb_id)) {
      return res.status(400).json({ success: false, error: 'Invalid tmdb_id. Must be numeric.' });
    }

    // Step 1: Get IMDB ID from vaplayer API
    const vaplayerUrl = `${VAPLAYER_API}?tmdb=${encodeURIComponent(tmdb_id)}&type=movie`;
    let vaplayerJson;
    try {
      vaplayerJson = await fetchJson(vaplayerUrl, vaplayerHeaders());
    } catch (e) {
      vaplayerJson = null;
    }
    const imdbId = (vaplayerJson && vaplayerJson.data && vaplayerJson.data.imdb_id) || null;
    const numericId = imdbId ? numericImdbId(imdbId) : null;

    if (!numericId) {
      return res.status(404).json({
        success: false, error: 'Could not resolve IMDB ID for this TMDB ID.',
        tmdb_id,
      });
    }

    // Step 2: Query OpenSubtitles REST API
    const subUrl = `${OPENSUB_SEARCH}/imdbid-${numericId}/sublanguageid-eng`;
    let subJson;
    try {
      subJson = await fetchJson(subUrl, { 'User-Agent': UA, 'Accept': 'application/json' });
    } catch (e) {
      console.error('[/src/sub/:tmdb_id] OpenSubtitles error:', e.message);
      return res.status(502).json({
        success: false, error: 'Failed to query OpenSubtitles.',
        detail: e.message, tmdb_id, imdb_id: imdbId,
      });
    }

    let rawList = [];
    if (Array.isArray(subJson)) rawList = subJson;
    else if (subJson && Array.isArray(subJson.data)) rawList = subJson.data;
    else if (subJson && typeof subJson === 'object') rawList = [subJson];

    const subtitles = rawList.map((sub, idx) => {
      const id = sub.IDSubtitleFile || sub.id || sub.IDSubtitle || idx;
      const name = sub.SubFileName || sub.filename || `Subtitle ${idx + 1}`;
      const lang = sub.SubLanguageID || sub.language || 'eng';
      return {
        id: String(id), code: lang, lang: lang, name: String(name),
        url: `${SUB_VTT_CDN}/${encodeURIComponent(String(id))}.vtt`,
        sub_id: String(id),
      };
    });

    return res.json({
      success: true, tmdb_id, imdb_id: imdbId,
      subtitle_count: subtitles.length, subtitles,
    });
  } catch (err) {
    console.error('[/src/sub/:tmdb_id] error:', err.message);
    return res.status(502).json({ success: false, error: err.message || 'Failed to fetch subtitles.' });
  }
});

/**
 * GET /src/webvtt/:subtitle_id
 * WebVTT from stellarconductornexus CDN.
 */
app.get('/src/webvtt/:subtitle_id', async (req, res) => {
  try {
    const { subtitle_id } = req.params;
    if (!subtitle_id) {
      return res.status(400).json({ success: false, error: 'Missing subtitle_id.' });
    }
    const vttUrl = `${SUB_VTT_CDN}/${encodeURIComponent(subtitle_id)}.vtt`;
    let vttText;
    try {
      vttText = await fetchText(vttUrl, {
        'User-Agent': UA,
        'Accept': 'text/vtt, text/plain, */*',
        'Referer': 'https://stellarconductornexus.com/',
      });
    } catch (e) {
      console.error('[/src/webvtt/:subtitle_id] fetch error:', e.message);
      return res.status(502).json({ success: false, error: 'Failed to fetch WebVTT subtitle.', detail: e.message, subtitle_id });
    }
    const trimmed = vttText.trim();
    if (!trimmed.startsWith('WEBVTT')) {
      res.set('Content-Type', 'text/vtt; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      return res.send('WEBVTT\n\n' + trimmed);
    }
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    return res.send(trimmed);
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
    version: '2.0.0',
    endpoints: {
      'GET /e/movie/:tmdb_id': 'Movie embed player (HTML) or JSON aggregates (Accept: application/json)',
      'GET /e/tv/:tmdb_id': 'TV series embed player (HTML) or JSON aggregates (Accept: application/json)',
      'GET /src/sub/:tmdb_id': 'Subtitle track list via OpenSubtitles (imdbid lookup)',
      'GET /src/webvtt/:subtitle_id': 'WebVTT subtitle content from stellarconductornexus CDN',
      'GET /health': 'Health check',
    },
    usage: {
      movie: 'https://vidgalactic.vercel.app/e/movie/550',
      tv: 'https://vidgalactic.vercel.app/e/tv/1396?season=1&episode=1',
      subs: 'https://vidgalactic.vercel.app/src/sub/550',
      webvtt: 'https://vidgalactic.vercel.app/src/webvtt/SUB_ID?url=...',
    },
  });
});

/* ---- start (local dev) ---- */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`VidGalactic API listening on http://localhost:${PORT}`);
    console.log(`  GET /e/movie/:tmdb_id   -> Movie embed player / JSON`);
    console.log(`  GET /e/tv/:tmdb_id      -> TV embed player / JSON`);
    console.log(`  GET /src/sub/:tmdb_id   -> Subtitle track list (OpenSubtitles)`);
    console.log(`  GET /src/webvtt/:id     -> WebVTT subtitle (stellarconductornexus)`);
  });
}

/* ---- Vercel serverless handler ---- */
module.exports = app;
