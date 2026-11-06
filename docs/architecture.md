# Phase 1 architecture

The React app uses the Vite same-origin `/api` proxy to FastAPI on loopback. It polls health and project metadata every 1.5 seconds without overlapping polls. Source playback uses byte-range responses. Selecting a completed project loads its persisted transcript; segment clicks seek the native video element.

Uploads are raw MP4 request bodies with a percent-encoded `X-Filename` header. The server generates a UUID and streams to a fixed `source.mp4` path, enforcing byte limits even without Content-Length. Original filenames are display metadata only. Partial uploads are cleaned up. This avoids multipart parsing that can spool oversized files before application validation.

SQLite stores IDs, original filenames, private paths, size, metadata, status, creation time, errors and warnings. Public responses exclude filesystem paths. SQL uses parameterized values. All project endpoints parse UUIDs and resolve paths from stored records.

One in-process executor owns a faster-whisper instance and processes jobs serially. Duplicate submissions of an active project are ignored. FFprobe validates and reads metadata; FFmpeg writes a temporary 16 kHz mono PCM WAV. The model uses a local directory and `local_files_only=True`; its lazy segment iterator is fully consumed before atomic JSON replacement and the completed state. CUDA errors during model construction or segment iteration trigger a full CPU attempt. Temporary audio is removed in `finally`.

States: frontend waiting → measured upload → backend waiting → preparing → transcribing → completed/failed. Queueing and failures are persisted. Startup converts orphaned active jobs to actionable failures. Completed-project cache reuse requires an existing readable result for that project. Repeated uploads intentionally create separate projects in V0.1.

The production process never calls model download APIs. A separate explicit setup script downloads weights. Fonts are bundled through npm packages. FFmpeg protocols are limited to local file/pipe input. The API permits only local Host and Origin values; it has no CORS policy granting remote sites access.

Run only one backend worker. SQLite protects concurrent requests, but queue ownership is process-local; multiple Uvicorn workers are unsupported. A future desktop shell can use Settings, Store, Jobs, and Transcriber without the web layer.

## Phase 2 stabilization

The original stack and worker architecture remain. See [discovery](phase2.md) and [stabilization](stabilization.md). An OS file lock enforces one engine per data directory. The job submission lock also serializes deletion: active jobs are rejected, and failed deletions remain visible and cannot be reprocessed. Ranked results live in SQLite with a project-local JSON audit copy. Ollama inference remains loopback-only.
