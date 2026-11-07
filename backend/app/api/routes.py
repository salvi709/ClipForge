import json
import logging
import os
import time
from pathlib import Path
from uuid import UUID, uuid4
from typing import Literal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from ..database.store import public_project
from ..services.media import available
from ..services.transcription import model_ready
from ..services.sentences import sentence_units
from ..services.media import ProcessingError
from ..services.deletion import DeletionError
from ..services.performance import record
from ..services.export import ClipExporter, ExportError
from ..services.evaluation import EvaluationMetrics
from ..models.discovery import ClipEdit, TranscriptionOptions, DiscoveryOptions, CategoryOverride
from ..models.export import ExportRequest, BatchExportRequest, ClipFeedback, ManualClipCreate

router = APIRouter(prefix='/api')


def project(request, project_id):
    row = request.app.state.store.get(str(project_id))
    if not row:
        raise HTTPException(404, 'Project not found.')
    return row


@router.get('/health')
def health(request: Request):
    settings = request.app.state.settings
    checks = {'ffmpeg': available(settings.ffmpeg), 'ffprobe': available(settings.ffprobe), 'model': model_ready(settings.model_path)}
    return {'status': 'ready' if all(checks.values()) else 'setup_required', 'checks': checks,
            'device_preference': settings.device, 'max_upload_bytes': settings.max_upload_bytes,
            'process_id': os.getpid(), 'ollama_model': settings.ollama_model, 'ollama_url': settings.ollama_url,
            'quality_model_ready': model_ready(settings.quality_model_path),
            'transcription_models': {'fast': settings.model_path.name, 'accurate': settings.quality_model_path.name}}


def validate_options(options, settings):
    if options.quality == 'accurate' and not model_ready(settings.quality_model_path):
        raise HTTPException(409, 'Quality model is missing. Run: python scripts/download_model.py --model small')


@router.get('/discovery/health')
def discovery_health(request: Request):
    return request.app.state.jobs.discovery.ollama.status()


@router.get('/projects')
def projects(request: Request):
    return [public_project(row) for row in request.app.state.store.list()]


@router.post('/projects', status_code=202)
async def upload(request: Request, language: Literal['auto', 'en'] = 'auto', quality: Literal['fast', 'accurate'] = 'fast'):
    """Stream raw MP4 bytes to disk; enforce the limit before buffering multipart files."""
    started = time.perf_counter()
    settings = request.app.state.settings
    validate_options(TranscriptionOptions(language=language, quality=quality), settings)
    filename = request.headers.get('x-filename', '')
    from urllib.parse import unquote
    filename = unquote(filename).replace('\\', '/').split('/')[-1]
    if not filename or len(filename) > 240 or any(ord(char) < 32 for char in filename) or Path(filename).suffix.lower() != '.mp4':
        raise HTTPException(415, 'Choose an MP4 video with a valid filename.')
    if request.headers.get('content-type', '').split(';')[0] not in {'video/mp4', 'application/octet-stream'}:
        raise HTTPException(415, 'Only MP4 videos are supported.')
    try:
        content_length = int(request.headers.get('content-length', '0'))
    except ValueError:
        raise HTTPException(400, 'Invalid upload length.') from None
    if content_length > settings.max_upload_bytes:
        raise HTTPException(413, 'Video exceeds the configured upload size limit.')
    upload_key = request.headers.get('x-upload-id')
    try:
        project_id = str(UUID(upload_key)) if upload_key else str(uuid4())
    except ValueError:
        raise HTTPException(422, 'Invalid upload request ID.') from None
    existing = request.app.state.store.get(project_id)
    if existing:
        return public_project(existing)
    directory = settings.data_dir / 'projects' / project_id
    source = directory / 'source.mp4'
    size = 0
    persisted = False
    try:
        directory.mkdir(parents=True)
    except FileExistsError:
        raise HTTPException(409, 'This upload is already in progress. Wait before retrying.') from None
    except OSError:
        raise HTTPException(507, 'Could not create project storage. Check disk space and permissions.') from None
    try:
        with source.open('wb') as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(413, 'Video exceeds the configured upload size limit.')
                await run_in_threadpool(output.write, chunk)
        if size == 0:
            raise HTTPException(400, 'The selected file is empty.')
        await run_in_threadpool(request.app.state.store.create, project_id, filename, source, size, language, quality)
        persisted = True
        elapsed = time.perf_counter() - started
        record(project_id, 'upload', elapsed, bytes=size)
        request.app.state.store.update(project_id, processing={'upload_seconds': round(elapsed, 4)})
        request.app.state.jobs.submit(project_id)
    except OSError:
        raise HTTPException(507, 'Could not store the video. Check free disk space and permissions for the local data directory.') from None
    finally:
        if not persisted:
            try:
                source.unlink(missing_ok=True)
                if directory.exists():
                    directory.rmdir()
            except OSError:
                pass
    return public_project(request.app.state.store.get(project_id))


@router.get('/projects/{project_id}')
def detail(project_id: UUID, request: Request):
    return public_project(project(request, project_id))


@router.post('/projects/{project_id}/cancel', status_code=202)
def cancel_project(project_id: UUID, request: Request):
    project(request, project_id)
    try:
        request.app.state.jobs.cancel(str(project_id))
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    return public_project(project(request, project_id))


@router.delete('/projects/{project_id}')
def delete_project(project_id: UUID, request: Request):
    try:
        request.app.state.jobs.delete(str(project_id))
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except DeletionError as error:
        raise HTTPException(500, str(error)) from None
    return {'deleted': True, 'project_id': str(project_id)}


@router.post('/projects/{project_id}/process', status_code=202)
def process(project_id: UUID, request: Request):
    project(request, project_id)
    try:
        request.app.state.jobs.submit(str(project_id))
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    return public_project(project(request, project_id))


@router.post('/projects/{project_id}/transcription', status_code=202)
def retranscribe(project_id: UUID, options: TranscriptionOptions, request: Request):
    project(request, project_id)
    validate_options(options, request.app.state.settings)
    try:
        request.app.state.jobs.submit(str(project_id), options.model_dump())
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    return public_project(project(request, project_id))


@router.post('/projects/{project_id}/discovery', status_code=202)
def discover(project_id: UUID, request: Request, options: DiscoveryOptions = DiscoveryOptions()):
    row = project(request, project_id)
    if row['status'] != 'completed':
        raise HTTPException(409, 'Complete transcription before finding clips.')
    try:
        request.app.state.jobs.submit_discovery(str(project_id), options)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    return request.app.state.jobs.discovery.result(str(project_id))


@router.post('/projects/{project_id}/discovery/cancel', status_code=202)
def cancel_discovery(project_id: UUID, request: Request):
    project(request, project_id)
    try:
        request.app.state.jobs.cancel_discovery(str(project_id))
    except ProcessingError as error:
        raise HTTPException(409, str(error)) from None
    except KeyError:
        raise HTTPException(404, 'Project not found.') from None
    return request.app.state.jobs.discovery.result(str(project_id))


@router.get('/projects/{project_id}/discovery')
def discovery_result(project_id: UUID, request: Request):
    project(request, project_id)
    return request.app.state.jobs.discovery.result(str(project_id))


@router.patch('/projects/{project_id}/clips/{clip_id}')
def adjust_clip(project_id: UUID, clip_id: str, edit: ClipEdit, request: Request):
    row = project(request, project_id)
    jobs = request.app.state.jobs
    with jobs.lock:
        row = project(request, project_id)
        if str(project_id) in jobs.pending:
            raise HTTPException(409, 'Wait for processing to finish before adjusting a clip.')
        result = jobs.discovery.result(str(project_id))
        if result['status'] != 'completed':
            raise HTTPException(409, 'Find clips before adjusting their timing.')
        all_clips = result.get('clips', []) + result.get('more_discoveries', [])
        if not any(clip['id'] == clip_id for clip in all_clips):
            raise HTTPException(404, 'Clip not found.')
        duration = json.loads(row['metadata'])['duration']
        if edit.end - edit.start < 1 or edit.end > duration:
            raise HTTPException(422, 'Clip range must be at least one second and stay within the video.')
        request.app.state.store.save_edit(str(project_id), clip_id, edit.start, edit.end)
    return jobs.discovery.result(str(project_id))


@router.get('/projects/{project_id}/video')
def video(project_id: UUID, request: Request):
    row = project(request, project_id)
    if not Path(row['source_path']).is_file():
        raise HTTPException(404, 'The local source video is missing.')
    return FileResponse(row['source_path'], media_type='video/mp4')


@router.get('/projects/{project_id}/transcript')
def transcript(project_id: UUID, request: Request):
    row = project(request, project_id)
    if row['status'] != 'completed':
        raise HTTPException(409, 'Transcription is not completed yet.')
    try:
        result = json.loads(Path(row['transcript_path']).read_text(encoding='utf-8'))
        if 'sentences' not in result:
            result['sentences'] = sentence_units(result, json.loads(row['metadata'])['duration'])
        return result
    except (OSError, ValueError, TypeError):
        raise HTTPException(404, 'The saved transcript is missing or unreadable. Retry processing.') from None


@router.patch('/projects/{project_id}/category')
def update_category(project_id: UUID, override: CategoryOverride, request: Request):
    """Allow user to override detected content category before discovery."""
    row = project(request, project_id)
    if row['status'] != 'completed':
        raise HTTPException(409, 'Complete transcription before setting content category.')
    with request.app.state.jobs.lock:
        if str(project_id) in request.app.state.jobs.pending:
            raise HTTPException(409, 'Wait for processing to finish before changing category.')
        request.app.state.store.update(str(project_id), user_category=override.category)
    return public_project(request.app.state.store.get(str(project_id)))


@router.post('/projects/{project_id}/clips/{clip_id}/export', status_code=202)
async def export_clip(project_id: UUID, clip_id: str, export_req: ExportRequest, request: Request):
    """Export a single clip as MP4."""
    row = project(request, project_id)
    
    # Get discovery results or manual clips to find clip
    result = request.app.state.jobs.discovery.result(str(project_id))
    all_clips = result.get('clips', []) + result.get('more_discoveries', [])
    clip = next((c for c in all_clips if c['id'] == clip_id), None)
    
    if not clip:
        # Check if it's a manually marked clip
        manual_clips = request.app.state.store.get_manual_clips(str(project_id))
        manual_clip = next((m for m in manual_clips if m['id'] == clip_id), None)
        if manual_clip:
            clip = manual_clip
        else:
            if result['status'] != 'completed':
                raise HTTPException(409, 'Complete discovery before exporting clips.')
            raise HTTPException(404, 'Clip not found.')
    
    # Generate export
    exporter = ClipExporter(request.app.state.settings.ffmpeg, request.app.state.settings.ffprobe)
    source_path = Path(row['source_path'])
    
    # Create exports directory
    exports_dir = source_path.parent / 'exports'
    exports_dir.mkdir(exist_ok=True)
    
    # Generate safe filename
    filename = exporter.generate_safe_filename(clip.get('title', 'clip'), clip.get('rank', 1))
    output_path = exports_dir / filename
    
    try:
        export_result = await run_in_threadpool(
            exporter.export_clip,
            source_path, output_path,
            clip['start'], clip['end'],
            export_req.strategy
        )
        
        # Save export record
        export_id = str(uuid4())
        request.app.state.store.save_export(
            export_id, str(project_id), clip_id,
            str(output_path), export_req.strategy,
            export_result['expected_duration'],
            export_result['file_size']
        )
        
        return {
            'export_id': export_id,
            'clip_id': clip_id,
            'filename': filename,
            **export_result
        }
    except ExportError as error:
        raise HTTPException(500, str(error)) from None


@router.get('/projects/{project_id}/exports/{export_id}')
def download_export(project_id: UUID, export_id: str, request: Request):
    """Download an exported clip."""
    project(request, project_id)
    exports = request.app.state.store.get_exports(str(project_id))
    export_record = next((e for e in exports if e['id'] == export_id), None)
    
    if not export_record:
        raise HTTPException(404, 'Export not found.')
    
    export_path = Path(export_record['export_path'])
    if not export_path.exists():
        raise HTTPException(404, 'Export file not found.')
    
    return FileResponse(export_path, media_type='video/mp4', filename=export_path.name)


@router.post('/projects/{project_id}/clips/export-batch', status_code=202)
async def export_batch(project_id: UUID, batch_req: BatchExportRequest, request: Request):
    """Export multiple clips as a ZIP archive."""
    row = project(request, project_id)
    
    # Get discovery results
    result = request.app.state.jobs.discovery.result(str(project_id))
    if result['status'] != 'completed':
        raise HTTPException(409, 'Complete discovery before exporting clips.')
    
    # Find requested clips
    clips = [c for c in result['clips'] if c['id'] in batch_req.clip_ids]
    if not clips:
        raise HTTPException(404, 'No valid clips found.')
    
    exporter = ClipExporter(request.app.state.settings.ffmpeg, request.app.state.settings.ffprobe)
    source_path = Path(row['source_path'])
    exports_dir = source_path.parent / 'exports'
    exports_dir.mkdir(exist_ok=True)
    
    # Export each clip
    clip_files = []
    for clip in clips:
        filename = exporter.generate_safe_filename(clip.get('title', 'clip'), clip.get('rank', 1))
        output_path = exports_dir / filename
        
        try:
            await run_in_threadpool(
                exporter.export_clip,
                source_path, output_path,
                clip['start'], clip['end'],
                batch_req.strategy
            )
            clip_files.append((str(output_path), filename))
        except ExportError as error:
            logger.warning('Failed to export clip %s: %s', clip['id'], error)
    
    if not clip_files:
        raise HTTPException(500, 'All clip exports failed.')
    
    # Create ZIP
    from datetime import datetime
    zip_filename = f"{row['filename'].rsplit('.', 1)[0]}_clips_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = exports_dir / zip_filename
    
    try:
        zip_result = await run_in_threadpool(
            exporter.create_batch_zip,
            clip_files, zip_path
        )
        
        return {
            'zip_filename': zip_filename,
            'clip_count': len(clip_files),
            **zip_result
        }
    except ExportError as error:
        raise HTTPException(500, str(error)) from None


@router.post('/projects/{project_id}/clips/{clip_id}/feedback')
def save_clip_feedback(project_id: UUID, clip_id: str, feedback: ClipFeedback, request: Request):
    """Save user feedback for a clip."""
    row = project(request, project_id)
    
    # Get discovery results to verify clip exists
    result = request.app.state.jobs.discovery.result(str(project_id))
    all_clips = result.get('clips', []) + result.get('more_discoveries', [])
    clip = next((c for c in all_clips if c['id'] == clip_id), None)
    
    # Also check manual clips
    if not clip:
        manual_clips = request.app.state.store.get_manual_clips(str(project_id))
        clip = next((m for m in manual_clips if m['id'] == clip_id), None)
    
    if not clip:
        raise HTTPException(404, 'Clip not found.')
    
    # Validate adjusted timestamps if provided
    if feedback.adjusted_start is not None and feedback.adjusted_end is not None:
        metadata = json.loads(request.app.state.store.get(str(project_id))['metadata'])
        duration = metadata['duration']
        
        if feedback.adjusted_start < 0 or feedback.adjusted_end > duration:
            raise HTTPException(422, 'Adjusted timestamps out of range.')
        if feedback.adjusted_end - feedback.adjusted_start < 1:
            raise HTTPException(422, 'Adjusted clip must be at least 1 second.')
    
    original_start = feedback.original_start if feedback.original_start is not None else clip.get('original_start', clip.get('start'))
    original_end = feedback.original_end if feedback.original_end is not None else clip.get('original_end', clip.get('end'))
    scoring_factors = feedback.scoring_factors or clip.get('scoring_factors')
    
    # Save feedback
    feedback_id = str(uuid4())
    request.app.state.store.save_feedback(
        feedback_id, str(project_id), clip_id,
        rating=feedback.rating, action=feedback.action,
        adjusted_start=feedback.adjusted_start, adjusted_end=feedback.adjusted_end,
        user_notes=feedback.user_notes,
        model_version=result.get('model'), algorithm_version=result.get('algorithm_version'),
        original_start=original_start, original_end=original_end,
        scoring_factors=scoring_factors
    )
    
    return {'feedback_id': feedback_id, 'clip_id': clip_id}


@router.post('/projects/{project_id}/manual-clips', status_code=201)
def create_manual_clip(project_id: UUID, manual_data: ManualClipCreate, request: Request):
    """Mark a moment manually when ClipForge missed an interesting part."""
    row = project(request, project_id)
    duration = json.loads(row['metadata'])['duration']
    if manual_data.end <= manual_data.start:
        raise HTTPException(422, 'Clip end time must be greater than start time.')
    if manual_data.end > duration:
        raise HTTPException(422, f'Clip end time cannot exceed video duration ({duration:.1f}s).')
    if manual_data.end - manual_data.start < 1.0:
        raise HTTPException(422, 'Manual clip must be at least 1 second long.')
    
    clip_id = str(uuid4())[:12]
    saved = request.app.state.store.save_manual_clip(
        clip_id, str(project_id), manual_data.title or 'Manual Moment',
        manual_data.start, manual_data.end, manual_data.notes
    )
    return saved


@router.get('/projects/{project_id}/manual-clips')
def get_manual_clips(project_id: UUID, request: Request):
    """Get all manually marked moments for a project."""
    project(request, project_id)
    return request.app.state.store.get_manual_clips(str(project_id))


@router.delete('/projects/{project_id}/manual-clips/{clip_id}')
def delete_manual_clip(project_id: UUID, clip_id: str, request: Request):
    """Delete a manually marked moment."""
    project(request, project_id)
    request.app.state.store.delete_manual_clip(str(project_id), clip_id)
    return {'deleted': True, 'clip_id': clip_id}


@router.get('/projects/{project_id}/feedback/stats')
def get_feedback_stats(project_id: UUID, request: Request):
    """Get evaluation metrics, reference clip comparisons, and heuristic estimates."""
    row = project(request, project_id)
    
    feedback_list = request.app.state.store.get_feedback(str(project_id))
    manual_clips = request.app.state.store.get_manual_clips(str(project_id))
    result = request.app.state.jobs.discovery.result(str(project_id))
    
    duration = 0.0
    if row.get('metadata'):
        try:
            duration = json.loads(row['metadata']).get('duration', 0.0)
        except Exception:
            pass
            
    category = row.get('user_category') or row.get('detected_category') or 'educational'
    all_clips = result.get('clips', []) + result.get('more_discoveries', [])
    
    user_metrics = EvaluationMetrics.calculate_metrics(feedback_list, all_clips, category=category, duration=duration)
    discovery_metrics = EvaluationMetrics.calculate_discovery_quality(result) if result.get('status') == 'completed' else {}
    ref_comparison = EvaluationMetrics.compare_with_reference(all_clips, manual_clips)
    
    return {
        'category': category,
        'user_feedback_metrics': user_metrics,
        'discovery_quality_metrics': discovery_metrics,
        'reference_comparison': ref_comparison,
        'manual_clips_count': len(manual_clips),
        'feedback_records': feedback_list
    }

