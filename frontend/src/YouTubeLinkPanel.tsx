import { useState } from "react";
import { Link2, Loader, AlertCircle, CheckCircle, Upload, FileText } from "lucide-react";

type YouTubeLinkPanelProps = {
  onProjectCreated?: (projectId: string) => void;
};

export default function YouTubeLinkPanel({ onProjectCreated }: YouTubeLinkPanelProps) {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{
    project_id: string;
    status: string;
    metadata?: any;
    segment_count?: number;
    warning?: string;
    error?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [showManualImport, setShowManualImport] = useState(false);
  const [manualTranscript, setManualTranscript] = useState("");
  const [manualFormat, setManualFormat] = useState<"srt" | "vtt" | "plain">("plain");
  const [importingManual, setImportingManual] = useState(false);

  async function handleAnalyze() {
    if (!url.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    setAnalyzing(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/youtube/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), language: "en" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to analyze YouTube video");
      }

      const data = await response.json();
      setResult(data);
      if (data.project_id) {
        onProjectCreated?.(data.project_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error analyzing YouTube video");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleManualImport() {
    if (!result?.project_id) {
      setError("No project to import transcript to");
      return;
    }

    if (!manualTranscript.trim()) {
      setError("Please paste transcript content");
      return;
    }

    setImportingManual(true);
    setError("");

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/api/youtube/transcript/${result.project_id}/manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: manualTranscript,
            format: manualFormat,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to import transcript");
      }

      const data = await response.json();
      setResult((prev) =>
        prev
          ? {
              ...prev,
              status: "completed",
              segment_count: data.segment_count,
              warning: undefined,
            }
          : null
      );
      setShowManualImport(false);
      setManualTranscript("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error importing transcript");
    } finally {
      setImportingManual(false);
    }
  }

  return (
    <div className="youtube-link-panel">
      <div className="youtube-heading">
        <h2>
          <Link2 size={19} className="ai-color" /> YouTube Link Analysis
        </h2>
        <p>Paste a YouTube URL to analyze and discover clip moments.</p>
      </div>

      <div className="youtube-input-section">
        <label>
          YouTube URL
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAnalyze();
            }}
            disabled={analyzing}
          />
        </label>

        <div className="youtube-button-group">
          <button
            className="primary"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || !url.trim()}
          >
            {analyzing ? (
              <>
                <Loader size={16} className="spin" /> Analyzing...
              </>
            ) : (
              <>
                <Link2 size={16} /> Analyze Video
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="youtube-result-section">
          <div className="result-status">
            {result.status === "completed" ? (
              <>
                <CheckCircle size={20} className="success" />
                <div>
                  <strong>Analysis Complete</strong>
                  {result.metadata && (
                    <p className="result-detail">
                      {result.metadata.title || "YouTube Video"}
                      {result.metadata.channel_name && ` • ${result.metadata.channel_name}`}
                    </p>
                  )}
                  {result.segment_count && (
                    <p className="result-detail">{result.segment_count} transcript segments</p>
                  )}
                </div>
              </>
            ) : result.status === "awaiting_transcript" ? (
              <>
                <AlertCircle size={20} className="warning" />
                <div>
                  <strong>Awaiting Transcript</strong>
                  <p className="result-detail">
                    {result.warning || "No captions found. Import a transcript to continue."}
                  </p>
                </div>
              </>
            ) : (
              <>
                <Loader size={20} className="spin" />
                <div>
                  <strong>Processing...</strong>
                </div>
              </>
            )}
          </div>

          {result.status === "awaiting_transcript" && (
            <div className="transcript-import-section">
              {!showManualImport ? (
                <button className="secondary" onClick={() => setShowManualImport(true)}>
                  <FileText size={14} /> Import Transcript
                </button>
              ) : (
                <div className="import-form">
                  <label>
                    Format
                    <select value={manualFormat} onChange={(e) => setManualFormat(e.target.value as any)}>
                      <option value="plain">Plain Text (estimated timestamps)</option>
                      <option value="srt">SRT Subtitles (HH:MM:SS,mmm format)</option>
                      <option value="vtt">WebVTT (HH:MM:SS.mmm format)</option>
                    </select>
                  </label>

                  <label>
                    Transcript Content
                    <textarea
                      placeholder="Paste transcript or subtitle file content here..."
                      value={manualTranscript}
                      onChange={(e) => setManualTranscript(e.target.value)}
                      rows={6}
                    />
                  </label>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="primary" onClick={() => void handleManualImport()} disabled={importingManual}>
                      {importingManual ? (
                        <>
                          <Loader size={14} className="spin" /> Importing...
                        </>
                      ) : (
                        <>
                          <Upload size={14} /> Import Transcript
                        </>
                      )}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setShowManualImport(false);
                        setManualTranscript("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {result.status === "completed" && (
            <div className="analysis-complete-notice">
              <CheckCircle size={16} className="success" />
              <p>Transcript is ready. You can now run clip discovery on this project.</p>
            </div>
          )}

          {result.project_id && (
            <p className="project-id-badge">Project ID: {result.project_id.substring(0, 8)}...</p>
          )}
        </div>
      )}

      {!result && !error && !analyzing && (
        <div className="youtube-empty-state">
          <Link2 size={48} style={{ opacity: 0.3 }} />
          <p>Ready to analyze a YouTube video</p>
          <p className="hint">Supported formats: youtube.com, youtu.be, shorts, live</p>
        </div>
      )}
    </div>
  );
}
