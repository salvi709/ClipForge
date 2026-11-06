# Phase 2: best-moment discovery

## Pipeline

1. Read the existing JSON transcript. No retranscription is involved in discovery.
2. Group timed words into sentences using recognized punctuation and pauses. Preserve the original segments/words. Exclude flagged uncertain spans; do not bridge those gaps.
3. Group adjacent sentences with lexical continuity, explicit topic transitions and pauses. These are local topic heuristics, not an embedding model.
4. Build bounded, contiguous windows around real sentence start/end times. Prefer 15–60 seconds; allow 8-second complete passages and up to 15 seconds beyond the preferred maximum to finish a sentence. At least 18 words are required. Spread the candidate budget across six temporal regions and distinct sentence starts so introductions and near-identical windows cannot consume the whole budget. Complete conclusion sentences receive priority; trailing questions are discouraged.
5. Send each bounded candidate separately to local Ollama. The structured schema constrains the candidate ID and offers verbatim evidence choices from its excerpt. The model never receives responsibility for timestamps. A fixed rubric rates hook, information, completeness and clarity. It returns a title, a specific reason and a verbatim evidence quote for each candidate.
6. Validate the schema, integer score range, exact candidate ID coverage, and verbatim evidence grounding. Retry invalid output once. A repeated failure becomes a failed job, not fabricated recommendations.
7. Calculate scores in Python, filter low-value/incomplete results, then remove heavy overlaps and near-duplicate text. Return up to four useful suggestions; fewer or zero is a valid result.
8. Save `clips.json`, the actual model digest, algorithm version, source transcript SHA-256, assessment audit data, score weights and ranked results. SQLite stores the complete ranked result in `discoveries.result_json`, plus job stage/error/progress and user timing edits separately. `clips.json` remains an audit copy and legacy fallback.

## Ranking contract

Each criterion is an integer from 0–5: absent/unusable, very weak, limited, useful, strong, exceptional.

```text
score / 100 = round(20 × (
  0.15 × hook_strength +
  0.40 × informational_value +
  0.35 × context_completeness +
  0.10 × clarity
))
```

The model must mark the candidate suitable; information and completeness must each be at least 3, clarity at least 2, and total score at least 60. This favors delivered learning over introductions, promises or clickbait. Selected candidates are suppressed if overlap is at least 35% of the shorter duration, or normalized content-term Jaccard similarity is at least 0.72. Ties use completeness, then source order. Scores describe the original range and remain explicitly labeled heuristic estimates after manual edits.

The verbatim-evidence check establishes that a quote occurs in the source; it cannot prove every generated explanation is correct. Users should review the source video. Transcript accuracy, topic boundaries and model judgments are limitations, not guarantees.

## Jobs, cache and memory

Discovery has independent states: preparing transcript, analyzing topics, evaluating candidates, ranking clips, completed and failed. The UI displays actual stages and the actual assessed-candidate count, with no estimated percentage. One queue serializes transcription/discovery, including across projects. Duplicate requests do not enqueue another task; re-transcription and timing edits cannot race an active discovery on the same project.

Whisper releases its model after processing and before discovery. Ollama uses `keep_alive=0` after each batch. This sacrifices some reload speed to keep memory available on 16 GB laptops. The app only manages its own model lifecycle, not models loaded by other applications.

The discovery fingerprint includes the transcript content, algorithm version, model tag and duration/budget settings. Bump `ALGORITHM_VERSION` when changing ranking logic. Existing suggestions reopen without Ollama. Model tag changes invalidate discovery; replacing the weights behind the exact same tag requires an algorithm-version bump or a new tag to invalidate the cache. Successful re-transcription clears old suggestions/edits; a failed attempt retains the prior files.

## API additions

| Route | Behavior |
| --- | --- |
| `DELETE /api/projects/{id}` | Permanent removal of owned files and project/dependent records; 409 if busy |
| `GET /api/discovery/health` | Local service/model readiness and setup instructions |
| `POST /api/projects?language=en&quality=accurate` | Existing streamed upload with transcription options |
| `POST /api/projects/{id}/transcription` | Explicit re-transcription using JSON language/preset |
| `POST /api/projects/{id}/discovery` | Idempotent cached or queued discovery |
| `GET /api/projects/{id}/discovery` | Persisted stage/result and overlaid saved timing edits |
| `PATCH /api/projects/{id}/clips/{clipId}` | Validated `{start,end}` seconds, within video, at least one second |

## Reproduce real validation

After installing FFmpeg, `small`, Ollama and `qwen2.5:3b`:

```powershell
.\.venv\Scripts\python.exe scripts\acceptance_phase2.py --video 'C:\path\lesson.mp4'
```

The script uploads through the real FastAPI application, forces English/Quality on CPU, calls real Ollama, validates candidate bounds/content, verifies unchanged transcript bytes, cache reuse and persistence after recreating the application. It blocks Python connections beyond loopback, uses installed Whisper files only, and retains its isolated project in `.runtime/phase2-acceptance` for inspection. Use `--stage transcription` then `--stage discovery` to separate the stages during setup. This is separate from unit tests with explicitly identified doubles. A physical network-disconnection test remains a distinct manual check.

## Execution record

See [stabilization validation](stabilization.md) for real-model measurements, current test results, and explicit limitations.
