# Transcription performance and loading fixes — November 2, 2026

## Findings and changes

- Actual GPU failure was `Library cublas64_12.dll is not found or cannot be loaded`. Compatible CUDA 12 cuBLAS DLLs already existed in `%LOCALAPPDATA%\Programs\Ollama\lib\ollama\cuda_v12`, but were not visible to the backend. Adding that directory to the backend process's DLL search path enabled **actual CUDA/FP16 inference**. No installation, driver change, system PATH change, model download, or Qwen invocation is involved. `CLIPFORGE_CUDA_DLL_DIR` can override this directory. If unavailable/incompatible, CPU INT8 fallback remains available, with one warning; a failed GPU configuration is not retried by that engine until restart.
- Every transcription previously released Whisper, forcing another initialization and GPU failure on the next job. The single worker now retains one model, replacing it when the preset changes and releasing it before discovery or shutdown. Base/small selection, beam size 5, VAD, word timestamps, and mono 16 kHz preparation are unchanged. No accuracy-reducing preset change was made.
- Model loading and inference previously shared the same `transcribing` state, with no timings/progress. New states are queued, extracting, loading_model, transcribing, saving, completed, failed, cancelled. Legacy waiting/preparing records remain supported. SQLite preserves elapsed time, stage, actual model/device/compute type, processed source seconds, heartbeat, and timing measurements. Timed-speech coverage is not a predicted completion percentage; silent intervals and uneven inference cost affect it.
- The old polling request could wait indefinitely on a broken connection. Metadata requests now have a 15-second network deadline and retry through the existing polling loop. This deadline does **not** terminate transcription. The UI shows disconnected/delayed updates and elapsed time instead of pretending progress is known.
- A previously active project was observed in `transcribing` without a warning or timing data. Its precise native call cannot be reconstructed from that old record. No historical hang location is claimed. New instrumentation distinguishes loading, inference, and persistence; restart recovery marks interrupted work failed.
- Cancellation uses `POST /api/projects/{id}/cancel`: queued work is removed immediately; FFmpeg is stopped; native model loading/inference cancels cooperatively at the next safe boundary. It may wait for an in-progress native operation and is displayed as requested, not prematurely cancelled. Saving is a short protected commit and rejects cancellation. Temporary files are removed; original uploads and prior saved transcripts are preserved. No arbitrary short inference timeout was added.
- Completed-project processing reuses its saved transcript. Duplicate active submissions remain guarded. Upload requests support `X-Upload-ID` UUID idempotency; the frontend sends a fresh ID per deliberate upload. Separate deliberate uploads of the same video still create separate projects.
- Transcription never calls Ollama; discovery stays independently initiated, with `qwen2.5:3b` unchanged.

## Actual measurements

Educational sample: 15.02 seconds; model **base**, GPU **float16**, CPU **int8**, four CPU threads, word timestamps enabled. One run per condition; timings are observations, not guaranteed speedups. OS/model caches and GPU warm-up differ.

| Measurement | Original CPU fallback | Fixed cold GPU API job | Fixed reused GPU API job |
|---|---:|---:|---:|
| Upload | not measured | 0.0344s | 0.0334s |
| Audio extraction | 0.2043s | 0.2217s | 0.1074s |
| GPU model loading | 0.8314s | 0.8430s | 0 (reused) |
| CPU fallback loading | 0.4803s | none | none |
| Failed GPU inference | 0.2524s | none | none |
| Successful inference | 1.9344s CPU | 1.0809s GPU | 0.4894s GPU |
| Transcription call including loading | 3.6691s | 2.0552s | 0.4949s |
| Transcript file saving | not measured | 0.0019s | 0.0023s |
| Database saving | not measured | 0.0060s | 0.0071s |
| Backend processing total | extraction + transcription: 3.8734s (probe/save excluded) | 2.4557s | 0.7032s |
| API upload through observed completion | not measured | 2.5441s | 0.8293s |

Full **151.70-second** educational recording, separate cold GPU run: extraction **0.3067s**, GPU detection **0.1089s**, model load **0.5824s**, inference including word alignment **5.9463s**, transcription call **6.6381s**. It produced 61 segments on CUDA/FP16. This full-video run measured extraction/transcription directly, not upload/persistence. Existing user transcripts were not overwritten. An initial full-video attempt referenced a project removed since the previous task and correctly failed extraction; the successful run used the current existing project.

Raw local measurements: `.runtime/performance/baseline.json`, `after.json`, and `full.json`. These contain metrics, not transcript text. Structured backend log events use `event=clipforge.performance`, stage, seconds, and project ID. Inference timing includes VAD, decoding, and timestamp alignment because faster-whisper produces them together; no separate fabricated timestamp-generation duration is reported.

## Verification and limits

**50 backend tests passed; 9 frontend tests passed; TypeScript/Vite production build passed.** Coverage includes GPU initialization/lazy inference failures followed by CPU, one fallback warning, partial GPU output discard, no-speech handling, FFmpeg failures, restart recovery, database persistence, duplicate requests, active/queued cancellation, responsive health requests during work, frontend completion removing loading/cancel controls, and existing discovery/deletion regressions. Real two-job GPU acceptance confirmed model reuse, saved transcripts, actual stages and completed states. Browser visual verification of the new progress block was not performed in this task; frontend behavior was tested through React interaction tests.

Cancellation cannot forcibly interrupt a hung CTranslate2 native call safely within the current thread-based worker. A process restart remains necessary for a truly stuck native operation; the next startup recovers its record as failed. Heartbeats indicate the worker process is responding, not proof that native inference is advancing. Model reuse retains RAM/VRAM until a preset change, discovery, or shutdown. CUDA libraries supplied by another installed application may move during its upgrades; configure an existing compatible directory explicitly or use CPU mode in that case.

Compatibility references: [faster-whisper GPU setup](https://github.com/SYSTRAN/faster-whisper#gpu), [CTranslate2 performance guidance](https://opennmt.net/CTranslate2/performance.html).

## Changed files

Backend: `app/core/cuda.py` (new), `core/config.py`, `services/performance.py` (new), `services/transcription.py`, `services/media.py`, `services/jobs.py`, `database/store.py`, `api/routes.py`; tests: `tests/test_api.py`, `tests/test_progress.py` (new). Frontend: `src/App.tsx`, `src/api.ts`, `src/styles.css`, `src/App.test.tsx`. Documentation: this report and README.

## Restart and test

Stop the existing backend/frontend with Ctrl+C in their terminals. From the repository root:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
$env:CLIPFORGE_DEVICE = 'auto'
$env:CLIPFORGE_OLLAMA_MODEL = 'qwen2.5:3b'
.\scripts\start-backend.ps1
```

In a second terminal:

```powershell
& 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge\scripts\start-frontend.ps1'
```

Open http://127.0.0.1:5173. For CPU-only operation set `CLIPFORGE_DEVICE=cpu` before backend startup. Model paths remain configurable through `CLIPFORGE_MODEL_PATH` and `CLIPFORGE_QUALITY_MODEL_PATH`. No additional download is needed on this machine.

```powershell
# From the repository root:
.\.venv\Scripts\python.exe -m pytest backend/tests -q
Push-Location frontend
npm.cmd test
npm.cmd run build
Pop-Location
```
