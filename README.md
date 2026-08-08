# Sakuya

A self-hosted media library manager. Point it at folders of images/videos and it scans, thumbnails, and auto-tags your collection using an AI tagger model (WD SwinV2, ONNX) — with manual tags, a batch downloader, and background job tracking.

## Features

- **Library Management** — organize media into libraries backed by watched folders
- **Auto-Scan** — periodically rescan libraries for new/changed files, cleaning up missing files and thumbnails
- **AI Tagging** — auto-tag images with a booru-style ONNX tagger model (downloaded on first use)
- **Manual Tags** — add/edit your own tags alongside AI-generated ones
- **Thumbnails** — automatic thumbnail generation for images and videos (via Sharp/FFmpeg)
- **Downloader** — batch-download media with gallery-dl (auto-installed), with cookie file support and live progress via SSE
- **Job Tracking** — monitor scan/tag/thumbnail/download/model-download jobs in the background
- **Dashboard** — stats and insights across your libraries

## Tech Stack

- **Backend**: Bun + Express, TypeScript, SQLite via Drizzle ORM
- **Frontend**: React 18 + Vite, React Router, Tailwind CSS
- **ML**: ONNX Runtime (onnxruntime-node)
- **Media Processing**: Sharp (images), FFmpeg/FFprobe (video)
- **Downloads**: gallery-dl

## Prerequisites

- [Bun](https://bun.sh) — used as the package manager and runtime for both install and dev

## Setup & Run

```bash
# 1. Install dependencies
bun install

# 2. Start server + web app together (dev mode)
bun dev
```

- Backend API: `http://localhost:3777`
- Frontend (Vite dev server, proxies `/api` to the backend): `http://localhost:5173`

Open `http://localhost:5173` in your browser once both are running.

Alternatively, use the bundled setup scripts (`setup.sh`/`setup.bat`), which install Bun for you if it's missing:

```bash
./setup.sh   # installs Bun (if needed) + dependencies
./run.sh     # starts the dev server
./update.sh  # git pull + reinstall dependencies
```

### Other useful commands

```bash
bun dev:server      # backend only
bun dev:web         # frontend only
bun typecheck       # typecheck server + web
bun build           # build the web app to apps/web/dist
```

To run the built server in production:

```bash
bun run --cwd apps/server start
```

### Configuration

The server needs no configuration to start — data (SQLite DB, thumbnails, uploads, and the downloaded tagger model) is stored under `apps/server/data/` by default. Override with environment variables if needed:

| Variable          | Default              | Purpose                      |
|--------------------|----------------------|-------------------------------|
| `PORT`             | `3777`                | Server port                   |
| `SAKUYA_DATA_DIR`  | `apps/server/data`    | Where DB/thumbnails/uploads/models are stored |

The AI tagger model (`wd-swinv2-tagger-v3`) is downloaded automatically as a background job the first time it's needed — no manual download required.

## Project Structure

```
sakuya/
├── apps/
│   ├── server/          # Bun + Express backend
│   │   └── src/
│   │       ├── routes/    # API endpoints (libraries, media, tags, jobs, tagger, downloader, ...)
│   │       ├── services/  # Scanning, thumbnailing, tagging, downloading, job queue
│   │       └── db/        # Drizzle schema + SQLite connection
│   └── web/              # React frontend
│       └── src/
│           ├── routes/     # Pages
│           ├── components/
│           ├── hooks/
│           └── lib/
├── packages/
│   └── shared/           # Types/utilities shared between server and web
└── package.json          # Workspace root (Bun workspaces)
```

## API Endpoints

- `/api/libraries` — library management
- `/api/media` — media file operations
- `/api/tags` — tag management
- `/api/jobs` — job status tracking
- `/api/settings` — user settings
- `/api/tagger` — AI tagging service
- `/api/downloader` — batch downloads via gallery-dl
- `/api/dashboard` — dashboard data
- `/api/uploads` — file uploads
- `/api/health` — health check

## License

Private project
