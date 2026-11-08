# VidGalactic API

**VidGalactic** is a lightweight backend API for movies and TV series streaming. It proxies the
[vaplayer.ru](https://vaplayer.ru) streamdata service, normalizes the response, and exposes clean,
CORS-enabled endpoints for HLS playback and WebVTT subtitles.

---

## Base URL

```
http://localhost:3000   (development)
https://api.vidgalactic.xyz   (production — example)
```

All responses are JSON unless otherwise noted.

---

## Endpoints

### 1. Movie Aggregates

```http
GET /e/movie/:tmdb_id
```

Returns everything needed to play a movie: title, backdrop, signed HLS stream URLs, and default
subtitle tracks.

**Path Parameters**

| Parameter   | Type   | Required | Description         |
|-------------|--------|----------|---------------------|
| `tmdb_id`   | string | Yes      | TMDB movie ID (numeric) |

**Example Request**

```bash
curl "http://localhost:3000/e/movie/550"
```

**Example Response**

```json
{
  "success": true,
  "type": "movie",
  "tmdb_id": "550",
  "title": "Fight Club",
  "imdb_id": "tt0137523",
  "file_name": "Fight.Club.1999.1080p.BluRay.x264-[YTS].mp4",
  "backdrop": "https://image.tmdb.org/t/p/w1280/...",
  "thumbnails_url": "https://vidapi.cloud/static/.../thumbnails.vtt",
  "stream_urls": [
    "https://dataanalyticsacademy.site/.../master.m3u8",
    "https://dataanalyticsacademy.site/.../master.m3u8"
  ],
  "default_subs": [
    {
      "id": "0",
      "code": "en",
      "lang": "en",
      "name": "English",
      "url": "https://subs.example.com/fightclub_en.srt"
    }
  ],
  "server_count": 2,
  "subtitle_count": 1
}
```

---

### 2. TV Series Aggregates

```http
GET /e/tv/:tmdb_id
```

Returns series aggregates including seasons, episodes, and stream URLs. Optionally pass `?season=N`
and `?episode=N` to fetch a specific episode's stream URLs.

**Path Parameters**

| Parameter   | Type   | Required | Description         |
|-------------|--------|----------|---------------------|
| `tmdb_id`   | string | Yes      | TMDB TV ID (numeric) |

**Query Parameters**

| Parameter   | Type   | Required | Description                     |
|-------------|--------|----------|---------------------------------|
| `season`    | number | No       | Season number                   |
| `episode`   | number | No       | Episode number                  |

**Example Request**

```bash
curl "http://localhost:3000/e/tv/1396?season=1&episode=1"
```

**Example Response**

```json
{
  "success": true,
  "type": "tv",
  "tmdb_id": "1396",
  "title": "Breaking Bad",
  "imdb_id": "tt0903747",
  "file_name": "Breaking.Bad.S01E01.1080p.BluRay.x264-[YTS].mp4",
  "backdrop": "https://image.tmdb.org/t/p/w1280/...",
  "thumbnails_url": "https://vidapi.cloud/static/.../thumbnails.vtt",
  "stream_urls": [
    "https://dataanalyticsacademy.site/.../master.m3u8"
  ],
  "default_subs": [],
  "eps": {
    "1": [1, 2, 3, 4, 5, 6, 7],
    "2": [1, 2, 3, 4, 5, 6, 7]
  },
  "seasons": [1, 2],
  "episodes": [
    { "s": 1, "e": 1 },
    { "s": 1, "e": 2 },
    { "s": 2, "e": 1 },
    { "s": 2, "e": 2 }
  ],
  "season_count": 2,
  "episode_count": 4,
  "server_count": 1,
  "subtitle_count": 0,
  "current_season": 1,
  "current_episode": 1
}
```

---

### 3. Subtitle Track List

```http
GET /src/sub/:tmdb_id
```

Returns all available subtitle tracks for a movie or TV show. Each track includes an `id`, language
code, and source URL.

**Path Parameters**

| Parameter   | Type   | Required | Description         |
|-------------|--------|----------|---------------------|
| `tmdb_id`   | string | Yes      | TMDB ID (numeric)   |

**Example Request**

```bash
curl "http://localhost:3000/src/sub/550"
```

**Example Response**

```json
{
  "success": true,
  "tmdb_id": "550",
  "subtitle_count": 2,
  "subtitles": [
    {
      "id": "0",
      "code": "en",
      "lang": "en",
      "name": "English",
      "url": "https://subs.example.com/fightclub_en.srt"
    },
    {
      "id": "1",
      "code": "es",
      "lang": "es",
      "name": "Español",
      "url": "https://subs.example.com/fightclub_es.srt"
    }
  ]
}
```

---

### 4. WebVTT Subtitle Content

```http
GET /src/webvtt/:subtitle_id?url=<subtitle_url>
```

Fetches a subtitle file (SRT or WebVTT) from its source URL, converts SRT to WebVTT if needed, and
serves it with `Content-Type: text/vtt`.

**Path Parameters**

| Parameter       | Type   | Required | Description                         |
|-----------------|--------|----------|-------------------------------------|
| `subtitle_id`   | string | Yes      | Subtitle identifier (client-defined) |

**Query Parameters**

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `url`     | string | Yes      | Full subtitle source URL (URL-encoded)   |

**Example Request**

```bash
curl "http://localhost:3000/src/webvtt/en-001?url=https%3A%2F%2Fsubs.example.com%2Ffightclub_en.srt"
```

**Example Response** (`Content-Type: text/vtt; charset=utf-8`)

```
WEBVTT

00:00:15.500 --> 00:00:18.200
I'm Jack. My name is Jack.

00:00:19.100 --> 00:00:21.900
The first rule of Fight Club is:
you do not talk about Fight Club.
```

---

### 5. Health Check

```http
GET /health
```

**Example Response**

```json
{
  "ok": true,
  "service": "vidgalactic-api",
  "time": "2026-11-08T14:58:00.000Z"
}
```

---

### 6. API Index

```http
GET /
```

Returns a list of all available endpoints.

---

## Quick Start

### Install

```bash
git clone https://github.com/<your-username>/VidGalactic.git
cd VidGalactic
npm install
```

### Run

```bash
npm start
# Server starts on http://localhost:3000
```

### Test Endpoints

```bash
# Health
curl http://localhost:3000/health

# Movie
curl http://localhost:3000/e/movie/550

# TV Series
curl http://localhost:3000/e/tv/1396?season=1&episode=1

# Subtitle list
curl http://localhost:3000/src/sub/550

# WebVTT subtitle
curl -H "Accept: text/vtt" \
  "http://localhost:3000/src/webvtt/en-001?url=https%3A%2F%2Fsubs.example.com%2Fsub.srt"
```

---

## ⚠️ OpenSubtitles IP Blocking Note

The `/src/sub/:tmdb_id` endpoint queries [OpenSubtitles REST API](https://rest.opensubtitles.org/). OpenSubtitles blocks requests from datacenter/Vercel IP addresses, so this endpoint may return `403 Forbidden` when deployed on Vercel.

- **Works locally** (residential IP): ✅
- **Works on Vercel** (datacenter IP): ❌ May return 403

**Workarounds:**
1. Run the API locally: `npm start`
2. Use a proxy/server with a residential IP
3. Call OpenSubtitles directly from your client (bypassing VidGalactic)

The `/src/webvtt/:subtitle_id` endpoint works on all platforms (Vercel included) since it fetches from stellarconductornexus CDN, not OpenSubtitles.

---

## Frontend Integration

Pair this API with the **Galactic V5** player templates:

- `/e/movie/{tmdb_id}` → `V5_Galactic-Movie-Template.html`
- `/e/tv/{tmdb_id}` → `Galactic-TV-Template-V2.html`

The player reads the TMDB ID from the URL path (`/e/movie/550` or `/e/tv/1396`) and calls the API
to fetch stream URLs and subtitles automatically.

---

## Architecture

```
Client (Galactic V5 Player)
        │
        ▼
VidGalactic API (Express)
        │
        ├─► GET /e/movie/:id   ─┐
        ├─► GET /e/tv/:id      ─┼─► https://streamdata.vaplayer.ru/api.php
        ├─► GET /src/sub/:id   ─┘
        └─► GET /src/webvtt    ─► Subtitle source URL → SRT→VTT conversion
```

---

## Requirements

- Node.js ≥ 18
- npm

### Dependencies

| Package   | Purpose                      |
|-----------|------------------------------|
| `express` | Web framework                |
| `cors`    | Cross-origin resource sharing|
| `helmet`  | Security headers             |
| `node-fetch` | HTTP client for upstream API calls |

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Disclaimer

VidGalactic is a proxy/aggregation layer. It does not host video content. Stream URLs and subtitles
are fetched from third-party sources (vaplayer.ru, dataanalyticsacademy.site, vidapi.cloud, and
subtitle providers). Use only for content you are authorized to access.
