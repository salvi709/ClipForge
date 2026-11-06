# Phase 2 stabilization — November 1, 2026

The existing React/FastAPI/SQLite stack and Chromatic V2 workspace are retained. No dependency reinstall, model download, CUDA installation, driver change, cloud inference, telemetry, or MP4 export was added or performed during this stabilization task.

## Identified causes

1. **Model mismatch:** the application default and setup instructions requested `qwen3:4b`, while the live local `/api/tags` contained only `qwen2.5:3b`. Stored discovery failures confirmed this exact mismatch. The default and scripts now use `qwen2.5:3b`; environment overrides still win and `.env` is not automatically loaded. Live health includes model/URL/PID. Historical failures that reference the previous model are shown as stale instead of continuing to tell users to pull Qwen3. No backend was initially listening on 8000; a user-started reload backend subsequently appeared and loaded the corrected configuration. It was reused, not killed.
2. **Structured evidence failure:** real Qwen2.5 analysis using the original prompt returned evidence that was not a verbatim source quote and failed both validation attempts. The JSON schema now supplies candidate-specific ID/evidence enums. Exact evidence/ID/score validation and one bounded retry remain; invalid output never becomes a fake suggestion. Only explicitly configured Qwen3 models receive `think=false`.
3. **Candidate and batch quality:** the initial 24-candidate run returned no eligible clips. Multiple near-identical windows sharing a start exhausted regional budgets, and four-item model responses repeated judgments across different excerpts. Candidate selection now rotates through distinct starts, considers completed sentence endings and conclusion cues, and disfavors dangling questions. Each candidate is assessed separately. Score thresholds were not relaxed. Algorithm version `discovery-2.1` invalidates old ranking caches without retranscribing.
4. **GPU inference:** actual faster-whisper iteration raised `RuntimeError: Library cublas64_12.dll is not found or cannot be loaded`. This occurred after successful device detection and model initialization. The environment contains faster-whisper 1.2.1, CTranslate2 4.8.4, ONNX Runtime 1.31.1; NVIDIA reports RTX 4050, driver 581.86, CUDA driver capability 13.0. Driver capability does not establish installed CUDA runtime DLLs. `CUDA_PATH` was unset. A bare ctypes probe initially could not load cuBLAS or cuDNN. The final diagnostic after importing CTranslate2 could load `cudnn64_9.dll`, but still could not load `cublas64_12.dll` or `cublasLt64_12.dll`; cuDNN is therefore not claimed to be absent. The first blocking inference error is cuBLAS. Whether a DLL is absent versus missing one of its dependencies/load-path entries is not distinguished by this error.
5. **Warning duplication:** the reported duplicate was not reproduced. Existing database warnings, a real reproduction, and the UI each contained one warning. The engine now explicitly permits one warning callback per job, includes the missing DLL basename, and logs the full exception. Tests ensure lazy GPU partial output is discarded, CPU runs once, and one warning is emitted.
6. **Persistence/deletion gaps:** discovery previously stored only a JSON path in SQLite and had no deletion feature. Complete ranked suggestions now live in SQLite, with a JSON audit/legacy copy. Permanent deletion has processing guards, path ownership validation, recoverable failure states, and actual file removal before transactional record removal. An OS lock prevents competing engines from recovering or recreating data while another engine owns it.

## Verified results

- **Backend:** 48 tests passed, 0 failed, including Windows junction protection, external paths, missing/busy projects, partial deletion/retry, interrupted deletion, engine locking, no speech, candidate bounds/diversity, model selection, local/cloud availability, invalid responses, timeout, SQLite persistence, GPU fallback and partial-output handling.
- **Frontend:** 8 tests passed, 0 failed; production TypeScript/Vite build passed. Initial test failures were caused by jsdom lacking native dialog methods; test-only dialog support fixed them. Production uses the browser's native accessible modal.
- **Real Ollama:** 24 candidates assessed from the existing 151.733-second educational video, with the original transcript SHA-256 unchanged. One suggestion passed unchanged quality thresholds: **Understanding Language Models**, **117.06–149.44 seconds**, **79/100**. Model: `qwen2.5:3b`, digest `357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`. Stored in SQLite and `clips.json`, rendered in the existing UI, and verified identical after backend reload. Repeated discovery reused the original result timestamp and transcript hash. This is a heuristic editorial judgment, not evidence of virality. No quota was filled.
- **Real transcription/deletion acceptance:** a separate 15-second local video went through real FFmpeg, faster-whisper, Ollama, SQLite, and the production API without inference doubles. Deletion while processing returned 409. Transcription completed on CPU with four segments and exactly one fallback warning. Discovery returned a valid empty result for this introductory passage. DELETE then removed the entire project folder and all project/discovery/edit records. The original test input and shared model remained. Report: `.runtime/stabilization-acceptance/report.json` (ignored local data).
- **Browser:** configured model and ranked card inspected; playback started at 117.06 seconds and automatically paused at exactly 149.44 seconds; themed deletion dialog opened and canceled. User projects were not deleted. Automated frontend tests exercise confirmation, disabled in-flight actions, success removal, cancellation and failure feedback; real deletion itself was verified through the production API on isolated test data.

GPU transcription remains unavailable in this Python environment; CPU fallback is operational. Do not install arbitrary CUDA packages or change drivers based on the card name alone. If acceleration is wanted, provision compatible NVIDIA runtime libraries deliberately using [faster-whisper's GPU instructions](https://github.com/SYSTRAN/faster-whisper#gpu), [CTranslate2's installation documentation](https://opennmt.net/CTranslate2/installation.html), and [NVIDIA's Windows cuDNN instructions](https://docs.nvidia.com/deeplearning/cudnn/installation/latest/windows.html), then run an actual inference diagnostic again. No successful GPU inference is claimed.

Physical network disconnection and arbitrary future Ollama models were not tested. The code uses loopback-only inference, ignores proxy variables, rejects cloud models/redirects, and never calls model download APIs. Transcript errors and sampling limits can reduce the number/quality of suggestions.

## Local data and deletion boundaries

Current project data is physically stored in `C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge\data`:

- `clipforge.sqlite3`: projects, full discovery results, timing edits.
- `projects\<uuid>\`: uploaded source, transcript, discovery audit, and any nested temporary/preview outputs.
- Shared models are in repository `models\` or the separately configured Ollama model library and are never project-deletion targets.

Deletion constructs the target from the managed root plus UUID and verifies ownership before recursive removal. Symlinks/junctions/reparse points and externally recorded paths are refused. A file lock/permission failure returns an error, retains `deletion_failed`, and requires retry; it never silently hides remaining data. The selected video is released by the UI before deletion. Startup marks interrupted deletions for retry. Original imports outside ClipForge, backups, OneDrive history and secure erasure are outside this feature. ClipForge does not upload data, but this workspace is in OneDrive; use a non-synced `CLIPFORGE_DATA_DIR` if OS-managed sync is unwanted.

## Exact restart and test commands

Stop the existing backend and frontend with Ctrl+C in their terminals before restarting; graceful backend shutdown waits for current jobs. Do not launch a second backend or use multiple workers. From the repository root:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
$env:CLIPFORGE_OLLAMA_MODEL = 'qwen2.5:3b'
# Reuses the running Ollama service. Does not pull/download any model.
.\scripts\start-ollama.ps1
.\scripts\start-backend.ps1
```

In another terminal:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
.\scripts\start-frontend.ps1
```

Open `http://127.0.0.1:5173`. For explicit CPU mode, set `$env:CLIPFORGE_DEVICE = 'cpu'` before starting the backend. Keep `auto` to reproduce GPU detection followed by safe fallback. No additional model download is needed on this laptop.

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/discovery/health
.\.venv\Scripts\python.exe scripts\diagnose_local.py

# Tests, including the already-present portable FFmpeg:
$ffmpegFile = Get-ChildItem .\.runtime\ffmpeg -Recurse -Filter ffmpeg.exe | Select-Object -First 1
$env:CLIPFORGE_FFMPEG = $ffmpegFile.FullName
$env:CLIPFORGE_FFPROBE = Join-Path $ffmpegFile.DirectoryName 'ffprobe.exe'
Push-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
Push-Location frontend
npm.cmd test
npm.cmd run build
Pop-Location
```

## Changed-file inventory

- Backend: `app/core/config.py`, new `app/core/instance.py`, `app/main.py`, `app/api/routes.py`, `app/database/store.py`, `app/services/ollama.py`, `transcription.py`, `candidates.py`, `discovery.py`, `jobs.py`, new `deletion.py`.
- Backend tests: `tests/test_discovery.py`, `tests/test_transcription.py`, new `tests/test_deletion.py`.
- Frontend: `src/App.tsx`, new `src/DeleteProjectDialog.tsx`, `src/api.ts`, `src/styles.css`, `src/DiscoveryPanel.tsx`, `src/App.test.tsx`, `src/test-setup.ts`, `package-lock.json` (root version aligned to existing package version; no dependency change).
- Scripts: `start-backend.ps1`, `start-ollama.ps1`, `pull-discovery-model.ps1`, new `diagnose_local.py`.
- Documentation: `README.md`, `docs/architecture.md`, `docs/phase2.md`, `docs/testing.md`, this report, and browser verification screenshots.
