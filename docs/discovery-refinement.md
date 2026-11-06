# Custom discovery and progress — 2 November 2026

The existing React/FastAPI/SQLite application and Chromatic V2 theme are preserved. Discovery uses the installed local `qwen2.5:3b`; no models, packages or drivers were installed, and no project media or transcript was uploaded to a cloud service. MP4 export remains outside this phase.

## What caused the empty results

The investigation followed the frontend request, FastAPI job, Ollama assessments, validation/ranking, SQLite result, GET response and rendered cards before making changes. Two saved educational-video analyses each contained **24 actual assessments, all rejected**. The empty results were saved and returned correctly; these were not lost database rows or missing card rendering. Another transcription of the same video already had one valid suggestion.

The fast/base transcript contains recognition errors, uncertain ranges and missing punctuation that combine several thoughts into long sentence units. That restricts usable windows, especially with strict duration constraints. Some Ollama rejection explanations also demanded a worked example even where a definition and concrete applications were present. The rubric now explicitly recognizes useful definitions/applications without demanding code or an entire tutorial, while retaining the existing score thresholds, grounding and duplicate checks. This does not guarantee that every transcript has a qualifying clip: the fast transcript still returned zero valid Standard clips in verification, and the interface explains that result.

Other confirmed issues: the API accepted no preferences; any completed result was reused regardless of a user's intended new settings; the old generator allowed short/long duration exceptions; Ollama used `keep_alive=0` for every individual candidate; and discovery lacked cancellation and persisted elapsed/stage details. These behaviors are corrected. Ollama documents [structured output schemas](https://docs.ollama.com/capabilities/structured-outputs) and [the keep-alive parameter](https://docs.ollama.com/api/chat).

## Behavior and API

- Number-of-clips slider: **1–10, default 5**. It is a target/maximum, not a quota.
- Duration choices: **Short 15–30s, Standard 30–60s (default), Long 60–90s, Custom**. Custom bounds must satisfy `5 <= minimum < maximum <= 120`. A source shorter than the minimum gets an actionable validation error. Maximum may exceed source length, but every candidate must end within the source.
- `POST /api/projects/{id}/discovery` accepts `{ "clip_count": 5, "min_seconds": 30, "max_seconds": 60 }`. Omitting the body uses those defaults. Invalid options/source constraints return 422; incompatible work already running returns 409. Identical active submissions reuse the existing job; GET/polling never creates jobs.
- Candidate generation uses the selected range, actual sentence/word timestamps and a bounded budget distributed across the video (24 candidates by default). It avoids uncertain spans and long gaps. The selected count/range also reaches the Ollama prompt. Candidates are checked again before persistence; no duration exceptions or fabricated replacements are returned.
- Ranking retains the existing weights and thresholds. Overlap of at least 35% of the shorter clip, or high lexical similarity, removes duplicate suggestions. The requested count caps the final ranked list. Model judgments are fallible estimates and do not establish virality.
- Settings, transcript hash, algorithm version, model identity/digest, assessments and final results are persisted in SQLite; `clips.json` is the local audit copy. The cache includes preferences. Existing completed suggestions remain visible while a new attempt runs and after failure/cancellation. Successful replacement resets old timing edits in the same SQLite transaction. Reopening restores settings and results.
- `POST /api/projects/{id}/discovery/cancel` cancels queued work immediately; active work stops at the next safe boundary. No new results are committed after an accepted cancellation. Cancellation is rejected once saving has begun. Interrupted jobs recover to an explicit failure on backend startup; cancelled jobs remain cancelled.
- Ollama remains loaded for up to five minutes between requests, instead of unloading after each candidate. Transcription and discovery remain separate jobs on the existing single worker. No automatic download or cloud fallback was added.

## Progress and interface

SQLite records actual transitions through queue, transcript preparation, topic analysis, candidate generation, timestamp validation, Ollama assessment, ranking and saving. A heartbeat updates elapsed time every two seconds. The panel shows completed stages and an indeterminate animation where total work cannot be measured. During assessment only, it displays completed candidates / total candidates and **a percentage explicitly labelled as assessment-stage progress**, never as overall completion. Heartbeat delays and connection failures are reported without assuming success or failure.

Discovery polls every 1.5 seconds while active, 10 seconds while idle/completed, and 3 seconds after a connection error. Submission guards and stale-response checks prevent duplicate work or an older poll replacing a newer action. Stable preview callbacks and memoization keep video time updates from repeatedly rendering the discovery panel. The existing transcription progress/cancel panel is preserved.

Settings, progress and ranked cards have separate visual areas. Cards retain scores, criterion breakdown, reason, timestamps, duration, preview, evidence and manual range controls. The top result has a restrained border/text cue, and new cards use a brief appearance transition that respects reduced-motion preferences. Manual edits deliberately remain available within the video; changing timing does not rerun AI scoring, as the existing warning states.

## Real local verification

Source: the existing 151.7333-second educational screen recording. Its completed English/small transcript was reused without altering its media or transcription. Requests went through the running FastAPI API and actual local Qwen model; screenshots and playback checks used the real frontend.

| Requested settings | Actual result | Backend elapsed |
| --- | --- | --- |
| 5 clips, Standard 30–60s | 1 clip: 73.58–119.50s, length 45.92s, score 84 | 60s |
| 1 clip, Short 15–30s | 1 clip: 73.58–96.10s, length 22.52s, score 82 | 58.11s |
| 2 clips, Custom 25–35s | 2 clips: 73.58–100.52s (26.94s) and 96.52–128.20s (31.68s), scores 86 | 60.91s |
| 3 clips, Long 60–90s | 1 clip: 70.54–149.50s, length 78.96s, score 82 | 45.64s |
| 5 clips, Standard, fast/base transcript | 0 qualifying clips, explicit rejection summary | 64s |

All returned ranges and count caps were checked. The browser displayed generated suggestions, disabled settings during work, showed real candidate progress, and restored Long/3 after reload. A separate queued discovery was cancelled from the UI and visibly reached “Analysis cancelled”. Previous results remained available. The selected Long result preview began at 70.54 seconds in the actual source video with no media error.

## Tests

- Backend: **77 passed, 0 failed** (`pytest backend/tests -q`). Coverage includes count targets; duration presets/custom validation; too-short sources; schema/evidence errors and bounded retry; timestamp bounds; overlaps; fewer/no valid results; prompt preferences; stage transitions; queued/running cancellation; prior-result retention; startup failure/recovery; SQLite persistence; GPU/CPU fallback regressions; and safe project deletion, busy-project refusal and traversal/junction protection.
- Frontend: **16 passed, 0 failed** (`npm test`). Coverage includes request preferences, custom validation, source duration errors, restored settings, candidate progress, failure/cancellation, actual card structure, previews/manual edits, transcription transitions and deletion.
- Production TypeScript/Vite build: passed.
- One initial test invocation in the restricted runner stalled before results; rerunning with local native-library access passed. An npm test command issued from the repository root found no script; the documented command runs from `frontend` and passed. These were runner/working-directory issues, not unaddressed test failures.

Automated tests use controlled doubles for failure/timeout paths. The table above is actual local inference, not test fixtures. No new GPU benchmark or zero-speech-media benchmark was performed for this change; the prior transcription behavior and its regression suite were retained.

## Files modified

- Backend: `app/models/discovery.py`, `app/api/routes.py`, `app/database/store.py`, `app/services/candidates.py`, `app/services/discovery.py`, `app/services/jobs.py`, `app/services/ollama.py`.
- Backend tests: updated `tests/test_discovery.py`; added `tests/test_discovery_preferences.py`.
- Frontend: `src/api.ts`, `src/DiscoveryPanel.tsx`, `src/App.tsx`, `src/useClipPreview.ts`, `src/styles.css`; expanded `src/DiscoveryPanel.test.tsx`.
- Documentation: `README.md`, this report, and screenshots under `docs/screenshots/`.

## Storage, deletion and limits

Normal application data is at `C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge\data` (or `CLIPFORGE_DATA_DIR`): SQLite is `clipforge.sqlite3`; each project's files live in `projects\<UUID>`. The existing delete endpoint removes verified project-owned files and all project/discovery/edit records, rejects active work, refuses external paths/junctions and reports partial failure. Shared models/configuration are untouched. Regression tests verify this; no existing user project was deleted during this task.

This workspace is inside **OneDrive**. ClipForge itself makes no cloud upload, but OneDrive may sync the folder according to the user's existing OS settings; those settings were not changed. Diagnostic snapshots from this investigation are in `.runtime/discovery-v3` and contain saved analysis excerpts. They are outside the application's project store and are not removed by project deletion. The report screenshots also contain selected clip text. These development artifacts can be removed separately if desired.

Cancellation cannot forcibly interrupt a blocking native/HTTP operation. A current Ollama request may take up to the configured timeout (default 240 seconds) before cancellation is observed; malformed responses allow one retry, while timeouts do not retry. Very long transcripts are sampled within the bounded candidate budget, so some moments can be missed. Only the latest completed analysis is kept by the application, not a full preference/result history. Review the generated moments before using them; transcript quality and the small local model still limit editorial accuracy.

## Restart and test (PowerShell)

Stop the existing frontend/backend terminals with **Ctrl+C** before restarting. Keep the already-running Ollama service; otherwise start the installed Ollama application or run `ollama serve` in its own terminal. No model pull is needed for the installed model.

Backend terminal:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
$env:CLIPFORGE_OLLAMA_MODEL = 'qwen2.5:3b'
$env:CLIPFORGE_DEVICE = 'auto'
.\scripts\start-backend.ps1
```

Frontend terminal:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
.\scripts\start-frontend.ps1
```

Open `http://127.0.0.1:5173`. Select a completed project, choose discovery settings, then Find Best Clips. The existing Quality/small educational transcript produced the verified suggestions above.

Tests:

```powershell
Set-Location 'C:\Users\Sarthak Salvi\OneDrive\Documents\ChatGPT\ClipForge'
.\.venv\Scripts\python.exe -m pytest backend/tests -q
Set-Location frontend
npm.cmd test
npm.cmd run build
```

Local health checks:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/discovery/health'
Invoke-RestMethod 'http://127.0.0.1:11434/api/tags'
```
