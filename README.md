# ClipForge 0.3

A local video transcription and best-moment discovery workspace with universal content understanding. Import an MP4, transcribe speech, and ClipForge automatically detects your content type (educational, podcast, gaming, comedy, documentary, vlog) to intelligently find the best moments using category-aware AI strategies. Click **Find Best Clips** to rank useful, self-contained moments with a local Ollama model. Review the evidence, preview each range, and save timing adjustments. No MP4 rendering/export is included.

React + TypeScript + Vite + Tailwind CSS + Lucide on the frontend; Python 3.11 + FastAPI + FFmpeg/ffprobe + faster-whisper + SQLite locally. All fonts ship with the frontend. No account, cloud processing, analytics, or external font requests.

## Windows setup

Run these commands in PowerShell from the repository root. Install **Python 3.11 (64-bit)**, **Node.js 22 LTS or newer**, and **FFmpeg with ffprobe** first. Add FFmpeg's `bin` directory to PATH and open a new terminal. Get Windows builds through [FFmpeg's download page](https://ffmpeg.org/download.html#build-windows). Check:

```powershell
py -3.11 --version
node --version
ffmpeg -version
ffprobe -version
```

Create the environment and install dependencies (internet required):

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock.txt
cd frontend
npm.cmd ci
cd ..
```

If you use `uv`, `uv venv --python 3.11 .venv` is an alternative. The Python launcher is not required after the virtual environment exists.

### Download a model once

This explicit setup command downloads the multilingual `base` faster-whisper model into `models/base` (roughly 150 MB):

```powershell
.\.venv\Scripts\python.exe scripts\download_model.py --model base
```

`base` is the lightweight **Fast** preset, not a guarantee of transcription accuracy. Install the optional **Quality** preset:

```powershell
.\.venv\Scripts\python.exe scripts\download_model.py --model small
```

The UI offers **English** (passed explicitly as `language="en"`) and **Auto Detect** for either preset. Multilingual `small` is the quality default; English-only `small.en` is not the default because testing exposed repeated phrases in parts of the sample. Quality runs more slowly and can still make mistakes. For code-switched speech, try Auto Detect. A quality change takes effect on a new upload or an explicit **Re-transcribe** action; saved transcripts are never silently regenerated.

VAD removes non-speech spans using a 500 ms minimum silence interval and 250 ms speech padding. Decoding disables previous-text conditioning and uses conservative silence/log-probability/compression settings. Sentence boundaries come from existing punctuation, word timing and pauses; no LLM rewrites the transcript. Repetitive, implausibly dense or low-confidence recognition is retained in the raw JSON, flagged, and excluded from the sentence view/discovery. These filters can omit genuine speech; review flagged ranges in the source video.

The model directory must contain `model.bin`, `config.json`, `tokenizer.json`, and a `vocabulary.txt` or `vocabulary.json` file. Copy the entire prepared directory for offline installation.

Processing never invokes the downloader. A missing/incomplete model produces setup instructions. To transfer to another offline PC, install compatible dependencies and copy model files there before disconnecting; Python environments themselves are not generally portable.

### Install local clip-discovery AI

If Ollama and `qwen2.5:3b` are already installed, skip installation and downloads. Check `ollama list`. Otherwise install [Ollama for Windows](https://ollama.com/download/windows), start its local service, and explicitly download the default model once:

```powershell
ollama serve
# In another terminal, while Ollama is running:
ollama pull qwen2.5:3b
```

`qwen2.5:3b` is a quantized local model with an approximately 1.9 GB download. ClipForge uses temperature 0, seed 42, an 8,192-token context, and schema-constrained JSON. Discovery evaluates one candidate per request to avoid mixing judgments. Qwen2.5 receives no Qwen3-only thinking flag; that flag is disabled only when explicitly configuring a Qwen3 model. The default is intended as a laptop-sized starting point, not a guarantee of speed on every GPU. CPU operation works through Ollama but is slower. Use the full official Ollama installation for supported GPU acceleration.

If a portable CPU runtime is already present under `.runtime/ollama`, the supplied scripts can use it instead:

```powershell
.\scripts\start-ollama.ps1
# In another terminal; explicit first-time model download:
.\scripts\pull-discovery-model.ps1
```

The scripts reuse an already-running server and prefer installed Ollama over the optional portable runtime. Only the portable fallback stores weights in this repository's ignored `models/ollama` directory. The normal Ollama installation uses its own configured model store. Keep using the same server/store that downloaded the model. The app never calls Ollama's pull API, never falls back to a paid service, rejects cloud-backed models, ignores proxy settings for inference, and permits only loopback Ollama URLs.

## Run

Keep Ollama running for discovery. From the repository root, use two additional terminals:

```powershell
# Backend
.\scripts\start-backend.ps1
```

```powershell
# Frontend
.\scripts\start-frontend.ps1
```

Open **http://127.0.0.1:5173**. If PowerShell policy prevents running local scripts, the equivalent direct commands are:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# In another terminal:
cd frontend
npm.cmd run dev
```

Keep one backend process, with one worker. Stop it with Ctrl+C; a graceful stop waits for its running/queued work. After an abrupt termination, interrupted jobs are marked failed on next startup and can be retried. Completed projects reopen from the sidebar.

Transcription and discovery share that worker. Whisper retains one loaded model between transcription jobs and releases it before discovery; Ollama stays warm for up to five minutes between assessments (`keep_alive="5m"`), avoiding a reload for every candidate. ClipForge does not run both GPU workloads simultaneously. Other applications may still occupy GPU memory.

**Workflow:** upload → select project → review transcript → **(NEW in v0.3: check detected content category)** → **Find Best Clips** → select a ranked card → **Preview clip**. Playback seeks to the candidate start and pauses at its end. Expand **Transcript & timing** to inspect the excerpt and save revised seconds. Manual edits keep the original heuristic score and selection reason; they do not rerank the new range. **Re-transcribe** replaces the transcript and clears old suggestions only after successful transcription.

ClipForge 0.3 introduces **universal content understanding**: After transcription, the system automatically detects whether your video is educational, podcast, gaming, comedy, documentary, vlog, or generic content. Discovery then uses category-specific AI prompts and strategies optimized for that content type. Override the detected category via API if needed. See [Content Understanding Guide](docs/content-understanding.md) for details.

For the built frontend: run `npm.cmd run build`, then `npm.cmd run preview` in `frontend`, and open http://127.0.0.1:4173 while the backend runs. Both dev and preview servers proxy `/api` to localhost:8000. Opening `dist/index.html` directly does not provide an API connection.

## Offline use and storage

Once packages, model files, and FFmpeg are installed, the same commands work offline. Video and transcription processing never require an external service. `local_files_only=True` and an explicit model directory prevent automatic model downloads. Source videos stay unchanged. The app copies uploads to:

```text
data/
  clipforge.sqlite3
  projects/<uuid>/
    source.mp4
    transcript.json
    clips.json
models/base/
```

Temporary mono 16 kHz WAV audio is removed after processing. Transcript JSON includes language confidence, segment/word timestamps, sentence groups, uncertainty flags, the chosen preset and actual device used. Completed results are reused when reopening/reprocessing the same project. Discovery reads the saved transcript without extracting audio or running Whisper. Its separate cache is keyed by transcript bytes, algorithm version, LLM name and duration/result settings. A new request with different preferences or ranking logic runs discovery again without retranscription; previous completed suggestions remain available during a new attempt and after failure or cancellation. Saved suggestions and SQLite results and timing edits reopen even with Ollama stopped. Uploading the same file again creates a separate project. Back up `data` with the backend stopped, including SQLite and project folders. Data/models are gitignored.

Existing Phase 1 projects are migrated additively on startup. Their source files and transcripts are preserved; language/preset defaults for old records are Auto/Fast.

Local-first is not disk encryption. Choose a non-synced `CLIPFORGE_DATA_DIR` if your checkout is in OneDrive or another synced directory. ClipForge itself sends no media externally; system backup/sync software is outside its control.

## Configuration

Set environment variables in the backend terminal **before startup**. `.env` files are not automatically loaded.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLIPFORGE_DATA_DIR` | Repository `data/` | Managed projects and SQLite |
| `CLIPFORGE_MODEL_PATH` | Repository `models/base/` | Complete local model directory |
| `CLIPFORGE_QUALITY_MODEL_PATH` | Repository `models/small/` | Quality preset local model directory |
| `CLIPFORGE_DEVICE` | `auto` | `auto`, `cpu`, or `cuda` |
| `CLIPFORGE_CPU_THREADS` | `4` | CPU inference threads |
| `CLIPFORGE_MAX_UPLOAD_MB` | `2048` | Streaming upload limit in MiB |
| `CLIPFORGE_FFMPEG` | `ffmpeg` | Executable name or absolute path |
| `CLIPFORGE_FFPROBE` | `ffprobe` | Executable name or absolute path |
| `CLIPFORGE_OLLAMA_URL` | `http://127.0.0.1:11434` | Loopback only; remote inference is rejected |
| `CLIPFORGE_OLLAMA_MODEL` | `qwen2.5:3b` | Exact installed local model tag |
| `CLIPFORGE_OLLAMA_TIMEOUT` | `240` | Seconds allowed per AI batch |
| `CLIPFORGE_CLIP_MIN_SECONDS` | `15` | Legacy internal candidate-helper default; per-project API/UI preferences take precedence |
| `CLIPFORGE_CLIP_MAX_SECONDS` | `60` | Legacy internal candidate-helper default; per-project API/UI preferences take precedence |
| `CLIPFORGE_CLIP_MAX_RESULTS` | `4` | Legacy internal default; use the per-project clip-count control (default 5) |
| `CLIPFORGE_CLIP_MAX_CANDIDATES` | `24` | Bounded candidate evaluation budget (4–80) |

Example:

```powershell
$env:CLIPFORGE_DATA_DIR = "$env:LOCALAPPDATA\ClipForge\data"
$env:CLIPFORGE_DEVICE = 'cpu'
$env:CLIPFORGE_MODEL_PATH = (Resolve-Path '.\models\base').Path
$env:CLIPFORGE_FFMPEG = 'C:\ffmpeg\bin\ffmpeg.exe'
$env:CLIPFORGE_FFPROBE = 'C:\ffmpeg\bin\ffprobe.exe'
```

`scripts/start-backend.ps1` also discovers a portable FFmpeg build under `.runtime/ffmpeg` if present; explicit environment settings take priority. Ordinary installations should use PATH or the executable settings.

### NVIDIA acceleration

CPU inference uses INT8. `auto` probes CTranslate2 for CUDA devices, tries FP16 on GPU, and falls back to CPU with a visible warning if initialization or lazy transcription fails. Even `cuda` permits fallback. Device availability does not prove DLL compatibility; the health indicator confirms installed files/tools, not successful inference.

RTX 4050/5050 configurations depend on the installed NVIDIA driver, CTranslate2 build, CUDA, and cuDNN compatibility. Follow the current [faster-whisper GPU setup](https://github.com/SYSTRAN/faster-whisper#gpu) and [CTranslate2 installation guidance](https://opennmt.net/CTranslate2/installation.html). No CUDA/PyTorch installation is needed for CPU mode. GPU hardware validation is separate from the automated fallback tests.

## Verification

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm.cmd test
npm.cmd run build
```

See [testing and acceptance](docs/testing.md) for the real-engine smoke test, measured results, and remaining manual acceptance steps. Tests use isolated temporary data and explicitly identified transcription doubles; production code always calls faster-whisper.

See [Phase 2 algorithm and validation](docs/phase2.md) for the scoring formula, evidence validation, cache behavior, and executed discovery tests.

## Scope and limits

- MP4 only; FFprobe verifies that the file has readable video, positive duration, and an audio track. H.264/AAC is recommended for browser playback. Some MP4 codecs transcribe but do not play in every browser.
- One background worker processes jobs sequentially. Uploading shows measured transfer progress; processing shows actual stages without estimated percentages.
- No live partial transcripts, speaker diarization, clip exports, visual editing, authentication, or Studio Pro.
- Discovery assesses spoken content, not cinematic visuals, music or audience behavior. Scores are heuristic estimates, never performance guarantees. Bad transcription can still lead to bad recommendations; inspect the source and excerpts.
- Candidate boundaries use actual transcript timing. Choose 1–10 clips (default 5) and Short 15–30s, Standard 30–60s (default), Long 60–90s, or custom 5–120s bounds. AI suggestions strictly respect the selected range; no duration exceptions are added. A source shorter than the requested minimum is rejected with an explanation. Long videos are sampled across their duration within the evaluation budget, so some moments may be missed. No quota is filled with fabricated candidates.
- Bind all servers to loopback. This is a single-user local tool, not a public network service. Origin and Host checks constrain browser access; there is no multi-user security model.
- Large videos need space for the source copy and temporary uncompressed audio. FFprobe has a 60-second timeout; audio extraction has a two-hour timeout.
- Whisper can misrecognize names, overlap, music, or noise. Review important text. Word timings are estimates.

The processing engine lives in `backend/app/services` and does not depend on FastAPI or the frontend. `database` owns job persistence; `api` handles local transport and serialization. See [architecture](docs/architecture.md).


## Project deletion and diagnostics

Use the trash action beside a project in the library, review the permanent-deletion dialog, then confirm. The API is `DELETE /api/projects/{uuid}`. It removes the complete owned project folder first and then removes project, discovery, and timing-edit records in one SQLite transaction. Missing projects return 404; active transcription/discovery returns 409. A partial failure retains an actionable `deletion_failed` record and blocks processing until deletion is retried. A crash during deletion is recoverable on restart.

Paths are derived from the managed data root and UUID, never from a filename supplied by the browser. External recorded artifact paths, symlinks, and Windows junctions/reparse points are refused. Shared models/caches, configuration, other projects, and the user's original imported file are retained. The project folder includes any nested previews and temporary outputs. Files held open by another application may require closing that application before retrying. Backups, OneDrive version history, original files outside ClipForge, and filesystem forensic recovery are outside project deletion; this is not secure disk erasure.

Settings are read at backend startup, including environment overrides; `.env` is not loaded automatically. `/api/health` reports the live backend PID and configured Ollama model/URL. `/api/discovery/health` verifies the configured tag through `/api/tags` and `/api/show`; generation readiness is not inferred from GPU hardware. The startup script rejects an occupied port, and an OS lock prevents two engines from owning the same data directory. Keep one Uvicorn worker.

```powershell
.\.venv\Scripts\python.exe scripts\diagnose_local.py
# Optional actual inference diagnostic using an existing audio file:
.\.venv\Scripts\python.exe scripts\diagnose_local.py --audio 'C:\path\speech.wav'
```

See [stabilization results and exact restart commands](docs/stabilization.md) for the measured GPU failure, real Ollama results, deletion verification, and changed-file inventory.


## Transcription performance update

See [measured GPU performance, progress, cancellation, tests, and restart instructions](docs/transcription-performance.md). The backend now reuses Whisper, persists measured job progress, and supports cooperative cancellation. On Windows it can reuse existing CUDA 12 runtime DLLs from installed Ollama without installing packages or invoking Qwen. Set `CLIPFORGE_CUDA_DLL_DIR` to override that process-local runtime directory, or `CLIPFORGE_DEVICE=cpu` for CPU-only operation.

Custom discovery preferences, stage progress, cancellation, real-video verification and restart commands: [discovery refinement report](docs/discovery-refinement.md).
