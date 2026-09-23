<div align="center">

<img src="apps/web/public/icon.png" width="96" alt="Sakuya" />

# Sakuya

**A self-hosted media library that tags itself.**

Point it at folders of images and videos — it scans, thumbnails, and auto-tags your
collection with an AI booru-style tagger, then gets out of your way.

[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)](https://react.dev)
[![SQLite](https://img.shields.io/badge/db-SQLite-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

## Screenshots

<table>
<tr>
<td width="50%">

**Dashboard** — libraries, continue watching, recently viewed/added
<img src="docs/screenshots/dashboard.png" alt="Dashboard" />

</td>
<td width="50%">

**Explore** — tag sidebar, filters, search-as-you-type
<img src="docs/screenshots/board.png" alt="Explore" />

</td>
</tr>
<tr>
<td colspan="2">

**Downloader** — batch downloads via gallery-dl, with a live console
<img src="docs/screenshots/downloader.png" alt="Downloader" />

</td>
</tr>
</table>

## Features

- 🗂 **Libraries** — organize media into libraries backed by watched folders, with auto-scan that cleans up missing files and thumbnails; drag to reorder, rename inline
- 🤖 **AI Tagging** — auto-tags images with a booru-style ONNX model (WD SwinV2), sorted into rating / character / general tag groups; swap in a different tagger model from Settings
- ✍️ **Manual Tags** — add, edit, or promote your own tags alongside the AI-generated ones
- 🔎 **Explore & Search** — indexed full-text search with tag autocomplete, removable filter chips, and saved searches you can replay from the sidebar
- ✨ **Discover** — an opt-in recommendation feed built from what you like, watch and linger on, with a surprise slider and "I'm feeling lucky"
- 📌 **Boards** — hand-picked collections of media, managed straight from the viewer
- ❤️ **Likes** — heart anything from its thumbnail or detail view; liked media collects into its own library and filters Explore
- ☑️ **Multi-select & Bulk Actions** — tag, like, rename (pattern or regex), re-tag, regenerate thumbnails, add to boards or delete many files at once, each behind a preview of what will change
- ▶️ **Continue Watching** — resumes videos where you left off, updates live, and won't re-add a video that just autolooped
- 🔍 **Duplicate & Similar Detection** — scan a library and review duplicates/near-duplicates side by side, batch-delete what you don't need
- 🖼 **Thumbnails** — automatic thumbnails for images and video (Sharp + FFmpeg), with an opt-out if you'd rather serve originals
- ⬇️ **Downloader** — batch-download from URLs with gallery-dl (auto-installed), cookie file support, an interactive console, and live progress over SSE
- 🎬 **Transcoding** — browser-incompatible video formats are converted to mp4 in the background and served automatically
- 📊 **Job Tracking** — every scan/tag/thumbnail/download/model-download runs as a trackable background job
- 🔒 **Private by Default** — listens on loopback only; open it to your network with an optional password gate (signed, expiring sessions)
- 🎚 **Resource Limits** — one CPU budget sizes job concurrency and every thread pool, plus a real memory ceiling enforced by the OS

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime & package manager | [Bun](https://bun.sh) |
| Backend | Express + TypeScript, SQLite via Drizzle ORM |
| Frontend | React 18 + Vite, React Router, Tailwind CSS |
| ML | ONNX Runtime (`onnxruntime-node`), WD SwinV2 tagger |
| Media processing | Sharp (images), FFmpeg/FFprobe (video/transcoding) |
| Downloads | gallery-dl |

## Quick Start

```bash
bun install   # install deps for all workspaces
bun dev       # server on :3777, web on :5173 (Vite proxies /api)
```

Open `http://localhost:5173`. No configuration required to start — everything lives under
`apps/server/data/` by default, or in `~/.sakuya/` if that folder exists (`./setup.sh` offers to create
it, and Settings > System can move an existing library there).

Prefer scripts? `./setup.sh` installs Bun for you if it's missing, `./run.sh` starts dev, and
`./update.sh` pulls + reinstalls. `.bat` equivalents exist for Windows.

### Docker

```bash
cp sakuya.config.example.json sakuya.config.json   # or ./setup.sh
docker compose up -d                               # web on :8080, API on :3777
```

Mount your media folders (and set `cpus` / `mem_limit`) in a `docker-compose.override.yml` — see
the comment at the top of [`docker-compose.yml`](docker-compose.yml). Library folders must be mounted
at the same absolute path they have on the host.

## Configuration

Everything is configured in one file, **`sakuya.config.json`** in the repository root — read by the
server, the web dev server and Docker alike. It's created with the defaults on first run, is
gitignored, and every key is optional. Restart after editing it.

```json
{
  "$schema": "./packages/shared/sakuya.config.schema.json",
  "server": { "port": 3777, "host": "127.0.0.1", "dataDir": null, "https": false },
  "web": { "port": 5173 },
  "auth": { "enabled": false, "secret": "" },
  "limits": { "cpus": null, "memory": null }
}
```

| Setting | Default | Purpose |
|---|---|---|
| `server.port` | `3777` | API server port (the web dev server follows it). |
| `server.host` | `127.0.0.1` | Interface to bind. Set `0.0.0.0` to reach Sakuya from other machines — turn `auth` on first. |
| `server.dataDir` | `null` | DB, thumbnails, uploads and models. `null` = `~/.sakuya` if it exists, else `apps/server/data`. |
| `server.https` | `false` | Mark the login cookie `Secure`. Only with HTTPS in front. |
| `web.port` | `5173` | Web interface port. |
| `auth.enabled` / `auth.secret` | `false` / `""` | Require a password. Changing the secret signs everyone out. |
| `limits.cpus` | `null` | CPU budget in cores (fractions allowed). Sizes job concurrency and ffmpeg/onnx/libvips threads. |
| `limits.memory` | `null` | Hard memory ceiling, e.g. `"2g"`, enforced via systemd (Linux) or a job object (Windows). |

The `$schema` line gives VS Code and JetBrains autocomplete and hover docs. Typos in a key are
logged; a value of the wrong type stops startup with the key named. Environment variables are
**not** read outside Docker — in Docker, `SAKUYA_*` variables override the file.

Upgrading from a `.env` setup? The first start migrates it into `sakuya.config.json` for you; delete
the `.env` files afterwards.

See **[docs/SETUP.md](docs/SETUP.md)** for the details: Docker overrides, how resource limits are
enforced per platform, the workspace layout, and which folders you should never touch by hand
(looking at you, `apps/server/data/`).

## Development

```bash
bun run test        # server tests (each suite boots its own server + DB)
bun typecheck
bun lint
bun format
```

## API

The backend exposes a JSON API under `/api` — libraries, media, tags, jobs, settings, the AI
tagger, the downloader, dashboard stats, uploads, and a health check. Full reference with
request/response shapes: **[docs/API.md](docs/API.md)**.

## Project Structure

```
sakuya/
├── apps/
│   ├── server/          # Bun + Express backend
│   │   └── src/
│   │       ├── routes/    # API endpoints
│   │       ├── services/  # Scanning, thumbnailing, tagging, downloading, job queue
│   │       └── db/        # Drizzle schema + SQLite connection
│   └── web/              # React frontend
│       └── src/
│           ├── routes/     # Pages
│           ├── components/
│           ├── hooks/
│           └── lib/
├── packages/shared/      # Types/utilities shared between server and web
└── docker/                # nginx config for the container build
```

## License

MIT — see [LICENSE](LICENSE).
