"""
Clip export service for generating MP4 files from video time ranges.
Supports individual clip export and batch ZIP creation.
"""
import json
import logging
import re
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Dict, Optional, Callable
from uuid import uuid4

logger = logging.getLogger(__name__)


class ExportError(Exception):
    """Export operation failed."""
    pass


class ClipExporter:
    """Exports video clips using FFmpeg."""
    
    def __init__(self, ffmpeg_command='ffmpeg', ffprobe_command='ffprobe'):
        self.ffmpeg = ffmpeg_command
        self.ffprobe = ffprobe_command
    
    def export_clip(self, source_path: Path, output_path: Path,
                   start: float, end: float,
                   strategy: str = 'accurate',
                   progress_callback: Optional[Callable] = None) -> Dict:
        """
        Export a single clip from a video file.
        
        Args:
            source_path: Source video file
            output_path: Output MP4 file path
            start: Start time in seconds
            end: End time in seconds
            strategy: 'fast' (stream copy) or 'accurate' (re-encode)
            progress_callback: Optional callback(percentage, message)
        
        Returns:
            Dictionary with export results
        """
        duration = end - start
        
        if duration < 0.1:
            raise ExportError('Clip duration must be at least 0.1 seconds')
        
        if not source_path.exists():
            raise ExportError(f'Source video not found: {source_path}')
        
        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            if strategy == 'fast':
                result = self._export_fast(source_path, output_path, start, duration, progress_callback)
            else:
                result = self._export_accurate(source_path, output_path, start, duration, progress_callback)
            
            # Verify exported file
            if not output_path.exists():
                raise ExportError('Output file was not created')
            
            # Verify duration
            actual_duration = self._get_duration(output_path)
            duration_diff = abs(actual_duration - duration)
            
            if duration_diff > 0.5:  # More than 0.5s difference
                logger.warning('Duration mismatch: expected %.2fs, got %.2fs', duration, actual_duration)
            
            result.update({
                'output_path': str(output_path),
                'expected_duration': round(duration, 3),
                'actual_duration': round(actual_duration, 3),
                'duration_accurate': duration_diff <= 0.5,
                'file_size': output_path.stat().st_size
            })
            
            return result
            
        except subprocess.SubprocessError as e:
            raise ExportError(f'FFmpeg export failed: {e}') from e
        except Exception as e:
            raise ExportError(f'Export failed: {e}') from e
    
    def _export_fast(self, source: Path, output: Path, start: float, duration: float,
                    progress_callback: Optional[Callable] = None) -> Dict:
        """
        Fast export using stream copy (no re-encoding).
        Less accurate boundaries but very fast.
        """
        cmd = [
            self.ffmpeg, '-nostdin', '-y',
            '-ss', str(start),  # Seek before input (fast but less accurate)
            '-i', str(source),
            '-t', str(duration),
            '-c', 'copy',  # Stream copy
            '-avoid_negative_ts', 'make_zero',
            str(output)
        ]
        
        return self._run_ffmpeg(cmd, duration, progress_callback, 'fast')
    
    def _export_accurate(self, source: Path, output: Path, start: float, duration: float,
                        progress_callback: Optional[Callable] = None) -> Dict:
        """
        Accurate export with re-encoding.
        Precise boundaries but slower.
        """
        cmd = [
            self.ffmpeg, '-nostdin', '-y',
            '-ss', str(start),  # Seek after input (slower but accurate)
            '-i', str(source),
            '-t', str(duration),
            '-c:v', 'libx264',  # Re-encode video
            '-preset', 'fast',  # Encoding speed
            '-crf', '23',  # Quality (lower = better, 18-28 range)
            '-c:a', 'aac',  # Re-encode audio
            '-b:a', '192k',  # Audio bitrate
            '-avoid_negative_ts', 'make_zero',
            str(output)
        ]
        
        return self._run_ffmpeg(cmd, duration, progress_callback, 'accurate')
    
    def _run_ffmpeg(self, cmd: list, duration: float, progress_callback: Optional[Callable], strategy: str) -> Dict:
        """Execute FFmpeg command with progress tracking."""
        started = time.time()
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )
        
        # Track progress from stderr
        time_pattern = re.compile(r'time=(\d+):(\d+):(\d+\.\d+)')
        last_progress = 0
        
        try:
            for line in process.stderr:
                # Parse time= progress
                match = time_pattern.search(line)
                if match:
                    hours = int(match.group(1))
                    minutes = int(match.group(2))
                    seconds = float(match.group(3))
                    elapsed = hours * 3600 + minutes * 60 + seconds
                    
                    progress = min(99, int(elapsed / duration * 100)) if duration > 0 else 0
                    
                    if progress > last_progress and progress_callback:
                        progress_callback(progress, f'Exporting... {progress}%')
                        last_progress = progress
            
            process.wait()
            
            if process.returncode != 0:
                stderr_output = process.stderr.read() if hasattr(process.stderr, 'read') else ''
                raise subprocess.CalledProcessError(process.returncode, cmd, stderr=stderr_output)
            
            if progress_callback:
                progress_callback(100, 'Export complete')
            
            elapsed_time = time.time() - started
            
            return {
                'success': True,
                'strategy': strategy,
                'elapsed_seconds': round(elapsed_time, 2)
            }
            
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    
    def _get_duration(self, video_path: Path) -> float:
        """Get video duration using ffprobe."""
        try:
            cmd = [
                self.ffprobe, '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'json',
                str(video_path)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=True)
            data = json.loads(result.stdout)
            return float(data['format']['duration'])
            
        except Exception as e:
            logger.warning('Could not get duration for %s: %s', video_path, e)
            return 0.0
    
    def create_batch_zip(self, clip_files: list, zip_path: Path, progress_callback: Optional[Callable] = None) -> Dict:
        """
        Create a ZIP archive containing multiple exported clips.
        
        Args:
            clip_files: List of (file_path, archive_name) tuples
            zip_path: Output ZIP file path
            progress_callback: Optional callback(percentage, message)
        
        Returns:
            Dictionary with ZIP creation results
        """
        try:
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            
            total_files = len(clip_files)
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for index, (file_path, archive_name) in enumerate(clip_files):
                    if not Path(file_path).exists():
                        logger.warning('Skipping missing file: %s', file_path)
                        continue
                    
                    zf.write(file_path, archive_name)
                    
                    if progress_callback:
                        progress = int((index + 1) / total_files * 100)
                        progress_callback(progress, f'Adding clip {index + 1}/{total_files}')
            
            if progress_callback:
                progress_callback(100, 'ZIP archive created')
            
            return {
                'success': True,
                'zip_path': str(zip_path),
                'file_count': total_files,
                'file_size': zip_path.stat().st_size
            }
            
        except Exception as e:
            raise ExportError(f'Failed to create ZIP archive: {e}') from e
    
    def generate_safe_filename(self, title: str, rank: int, ext: str = '.mp4') -> str:
        """
        Generate a safe filename from clip title.
        
        Args:
            title: Clip title
            rank: Clip rank/number
            ext: File extension
        
        Returns:
            Safe filename string
        """
        # Remove/replace unsafe characters
        safe_title = re.sub(r'[^\w\s-]', '', title)
        safe_title = re.sub(r'[-\s]+', '_', safe_title)
        safe_title = safe_title[:50]  # Limit length
        
        return f'clip_{rank:02d}_{safe_title}{ext}'
