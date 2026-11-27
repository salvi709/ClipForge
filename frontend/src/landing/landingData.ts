export type LandingRoute = "/" | "/app" | "/privacy" | "/terms" | "/contact";

export interface PreviewClip {
  id: string;
  rank: string;
  title: string;
  category: string;
  start: string;
  end: string;
  duration: string;
  score: number;
  reason: string;
  criteria: {
    hook: number;
    information: number;
    context: number;
    clarity: number;
  };
  multimodal: {
    audio: string;
    visual: string;
    boundary: string;
  };
  excerpt: string[];
  titles: { style: string; text: string }[];
  captionSpec: {
    preset: string;
    placement: string;
    wordsPerLine: string;
  };
  cropRatio: string;
  editingNotes: string[];
  musicCue: string;
  platforms: string[];
}

export interface PreviewTranscriptLine {
  time: string;
  speaker: string;
  speakerColor: "teal" | "blue";
  text: string;
  clipId: string;
}

export const SHOWCASE_CLIPS: PreviewClip[] = [
  {
    id: "clip-1",
    rank: "01",
    title: "Why Latency Shapes Every Creative Decision",
    category: "Podcast · 91% confidence",
    start: "04:12",
    end: "04:58",
    duration: "46s",
    score: 91,
    reason:
      "Opens on a sharp contrarian claim, holds clean speaker cadence, and closes cleanly before the topic shift.",
    criteria: {
      hook: 94,
      information: 90,
      context: 88,
      clarity: 92,
    },
    multimodal: {
      audio: "+4.2 dB vocal emphasis at 04:13",
      visual: "Clean speaker cut on boundary",
      boundary: "Natural sentence pause at 04:58",
    },
    excerpt: [
      "04:12 · Maya Lin — People assume render speed is just an engineering metric, until you watch an editor hesitate to try a second cut.",
      "04:29 · Devon Cole — Once feedback drops below two seconds, experimentation goes up three or four times in the same session.",
      "04:46 · Maya Lin — That is why local timeline inspection changes what ends up in the final release.",
    ],
    titles: [
      { style: "Contrarian", text: "Render Speed Isn't Engineering — It's Creative Freedom" },
      { style: "Curiosity", text: "What Changes When Editors Stop Waiting for Previews" },
      { style: "Direct", text: "Why 2-Second Feedback Produces Better Cuts" },
    ],
    captionSpec: {
      preset: "High-contrast bottom-third",
      placement: "Safe zone above Reels UI",
      wordsPerLine: "4–6 words · SRT ready",
    },
    cropRatio: "9:16 vertical center-speaker track · 16:9 desktop option",
    editingNotes: [
      "Tighten 0.6s breath pause before \"Once feedback drops\"",
      "Add subtle keyframe zoom at 04:29 speaker turn",
    ],
    musicCue: "Low percussive pulse (-24 LUFS) · Drop out on Maya's closing line",
    platforms: ["YouTube Shorts", "Instagram Reels", "TikTok", "LinkedIn"],
  },
  {
    id: "clip-2",
    rank: "02",
    title: "Three Signals That Expose Weak Video Hooks",
    category: "Educational · 89% confidence",
    start: "11:08",
    end: "11:49",
    duration: "41s",
    score: 87,
    reason:
      "Structured three-part explanation with high standalone clarity and clear pause boundaries on both ends.",
    criteria: {
      hook: 86,
      information: 92,
      context: 85,
      clarity: 88,
    },
    multimodal: {
      audio: "Balanced speech pace, low silence ratio",
      visual: "Slide transition aligned at 11:08",
      boundary: "Self-contained takeaway at 11:49",
    },
    excerpt: [
      "11:08 · Devon Cole — Before cutting a teaser, check whether the first four seconds name a tension, a stakes shift, or an outcome.",
      "11:24 · Devon Cole — If the viewer needs the previous five minutes to care, move the in-point forward.",
      "11:38 · Maya Lin — Standalone context beats clever phrasing almost every time.",
    ],
    titles: [
      { style: "Checklist", text: "The 3-Second Test for Any Short-Form Hook" },
      { style: "Actionable", text: "Fix Weak Video Openers Using One Rule" },
      { style: "Insight", text: "Why Context Beats Cleverness in Short Clips" },
    ],
    captionSpec: {
      preset: "Clean sentence emphasis",
      placement: "Center-lower frame",
      wordsPerLine: "5 words · Highlighted keywords",
    },
    cropRatio: "9:16 speaker + upper slide PiP · 1:1 square feed variant",
    editingNotes: [
      "Display \"1 · 2 · 3\" subtle marker counters at top left",
      "Preserve 0.4s lead-in after slide change",
    ],
    musicCue: "Minimal Rhodes bed (-26 LUFS) · Fade cleanly on pause",
    platforms: ["YouTube Shorts", "LinkedIn", "X Video", "Instagram Reels"],
  },
  {
    id: "clip-3",
    rank: "03",
    title: "Balancing Audio Spikes Without Over-Compressing",
    category: "Tutorial · 86% confidence",
    start: "19:34",
    end: "20:14",
    duration: "40s",
    score: 84,
    reason:
      "Practical demonstration backed by audio energy spikes and a crisp conversational payoff.",
    criteria: {
      hook: 82,
      information: 89,
      context: 83,
      clarity: 85,
    },
    multimodal: {
      audio: "Dynamic range contrast detected",
      visual: "Workspace close-up active",
      boundary: "Zero mid-sentence clip drift",
    },
    excerpt: [
      "19:34 · Maya Lin — Heavy compression flattens excitement right out of a reaction moment.",
      "19:48 · Devon Cole — Keep natural peaks intact, trim dead air around them, and let the room breathe.",
    ],
    titles: [
      { style: "How-To", text: "Stop Crushing Reaction Audio in Your Edits" },
      { style: "Technique", text: "Keep Natural Energy Without Clipping Peaks" },
      { style: "Direct", text: "Better Clip Pacing in Under 40 Seconds" },
    ],
    captionSpec: {
      preset: "Studio subtitle standard",
      placement: "Bottom safe margin",
      wordsPerLine: "5–7 words · SRT export",
    },
    cropRatio: "16:9 widescreen walkthrough · 9:16 screen-top / cam-bottom",
    editingNotes: [
      "Show short audio waveform callout at 19:48",
      "Export fast MP4 stream copy for review before final color pass",
    ],
    musicCue: "Keep dry dialogue only during dynamic audio demo",
    platforms: ["YouTube Shorts", "Instagram Reels", "TikTok"],
  },
];

export const PREVIEW_TRANSCRIPT: PreviewTranscriptLine[] = [
  {
    time: "04:12",
    speaker: "Maya Lin",
    speakerColor: "teal",
    text: "People assume render speed is just an engineering metric, until you watch an editor hesitate to try a second cut.",
    clipId: "clip-1",
  },
  {
    time: "04:29",
    speaker: "Devon Cole",
    speakerColor: "blue",
    text: "Once feedback drops below two seconds, experimentation goes up three or four times in the same session.",
    clipId: "clip-1",
  },
  {
    time: "04:46",
    speaker: "Maya Lin",
    speakerColor: "teal",
    text: "That is why local timeline inspection changes what ends up in the final release.",
    clipId: "clip-1",
  },
  {
    time: "11:08",
    speaker: "Devon Cole",
    speakerColor: "blue",
    text: "Before cutting a teaser, check whether the first four seconds name a tension, a stakes shift, or an outcome.",
    clipId: "clip-2",
  },
  {
    time: "11:24",
    speaker: "Devon Cole",
    speakerColor: "blue",
    text: "If the viewer needs the previous five minutes to care, move the in-point forward.",
    clipId: "clip-2",
  },
  {
    time: "19:34",
    speaker: "Maya Lin",
    speakerColor: "teal",
    text: "Heavy compression flattens excitement right out of a reaction moment.",
    clipId: "clip-3",
  },
];

export const HOW_IT_WORKS_STEPS = [
  {
    step: "01",
    title: "Upload or Paste a Link",
    description:
      "Drop an MP4 recording into the local workspace or paste a YouTube URL with an optional SRT, VTT, or plain-text transcript.",
    detail: "MP4 uploads · YouTube URL + transcript import",
  },
  {
    step: "02",
    title: "Let ClipForge Analyze",
    description:
      "ClipForge transcribes spoken dialogue, evaluates audio energy and scene boundaries, classifies the content category, and maps speaker turns.",
    detail: "Speech · Audio energy · Visual changes · Speakers",
  },
  {
    step: "03",
    title: "Discover Your Best Moments",
    description:
      "Review ranked Top Picks and More Discoveries backed by Hook, Information, Context, Clarity, and multimodal evidence scores.",
    detail: "4-criterion + multimodal scoring · Evidence notes",
  },
  {
    step: "04",
    title: "Refine and Export",
    description:
      "Adjust exact start and end timestamps, rename speakers, pick hook titles, download SRT captions, and export MP4 clips or timestamped links.",
    detail: "FFmpeg MP4 export · SRT captions · ?t= links",
  },
];

export const USE_CASES = [
  {
    audience: "Podcasters",
    tag: "MULTI-SPEAKER DIALOGUE",
    summary:
      "Turn 90-minute conversations into standalone takeaways without losing speaker attribution or mid-thought context.",
    workflow: "Speaker timeline · Overlap detection · Hook + clarity ranking",
  },
  {
    audience: "Educators",
    tag: "LECTURES & TUTORIALS",
    summary:
      "Extract clear concept explanations with clean pause boundaries, searchable transcripts, and ready-to-download SRT captions.",
    workflow: "Auto-detected Educational profile · SRT export · Sentence search",
  },
  {
    audience: "Gaming Creators",
    tag: "STREAMS & HIGHLIGHTS",
    summary:
      "Pinpoint high-energy vocal reactions and scene transitions inside marathon VOD recordings without manual scrubbing.",
    workflow: "Audio spike signals · Custom 5–120s bounds · Fast MP4 cuts",
  },
  {
    audience: "Interview Creators",
    tag: "Q&A SESSIONS",
    summary:
      "Keep question setup and guest payoff together in one clean clip while renaming speaker labels across the whole episode.",
    workflow: "Speaker renaming · Manual boundary tweak · Top Picks ranking",
  },
  {
    audience: "Vloggers",
    tag: "STORYTELLING FOOTAGE",
    summary:
      "Spot narrative turning points, pacing peaks, and 9:16 framing guidance directly from unedited camera files.",
    workflow: "Visual boundary checks · Format guidance · Title variations",
  },
  {
    audience: "Video Editors",
    tag: "ROUGH-CUT PREPARATION",
    summary:
      "Hand off scored candidate timestamps, manual missed-moment markers, and stream-copied MP4 pulls before opening your NLE.",
    workflow: "Batch ZIP export · Fast or accurate FFmpeg · Feedback log",
  },
  {
    audience: "Content Agencies",
    tag: "MULTI-CLIENT WORKFLOWS",
    summary:
      "Standardize clip quality checks across client podcasts, webinars, and YouTube channels with transparent scoring criteria.",
    workflow: "Category override · Platform presets · Quality rating history",
  },
];

export const FAQ_ITEMS = [
  {
    question: "What is ClipForge?",
    answer:
      "ClipForge is a video analysis and clip discovery workspace built to transcribe recordings, analyze speech and media cues, rank high-potential clip moments, and prepare titles, captions, and MP4 exports.",
  },
  {
    question: "How does ClipForge discover clips?",
    answer:
      "After breaking transcripts into natural sentence units and evaluating audio energy and scene signals, ClipForge scores candidate ranges across Hook, Information, Context, and Clarity plus multimodal signals, separating strongest results into Top Picks and More Discoveries.",
  },
  {
    question: "Can ClipForge work with YouTube videos?",
    answer:
      "Yes. Paste a YouTube watch, short, share, or live URL to validate the link, retrieve video metadata, and run clip discovery. When captions are unavailable or disabled, you can import your own SRT, VTT, or plain-text transcript directly and copy timestamped YouTube playback links. ClipForge does not download YouTube MP4 files.",
  },
  {
    question: "Can I edit clip start and end times?",
    answer:
      "Yes. Every discovered clip lets you preview the range and update exact start and end timestamps, and you can also mark missed moments manually if there is a section you want tracked alongside discovered results.",
  },
  {
    question: "Can I export individual clips?",
    answer:
      "For uploaded MP4 projects, ClipForge uses FFmpeg to export individual MP4 clips in either fast stream-copy mode or frame-accurate re-encode mode, plus downloadable SRT caption files and a batch ZIP export endpoint.",
  },
  {
    question: "Does ClipForge detect video categories automatically?",
    answer:
      "Yes. ClipForge profiles each project into categories such as Podcast, Educational, Gaming, Documentary, Vlog, Comedy, Music, or Sports alongside confidence scores and supporting signals—and lets you override the category manually at any time.",
  },
  {
    question: "Does ClipForge process videos locally?",
    answer:
      "Uploaded MP4 files, FFmpeg audio/scene inspection, local database storage, and MP4 clip exports run locally on your ClipForge server on port 3000. When you submit a YouTube link, the server connects online only to validate the URL and look up video metadata.",
  },
  {
    question: "What formats are supported?",
    answer:
      "Video uploads accept .mp4 files up to the server's configured size limit (default 2 GB). For YouTube link workflows, manual transcript import supports .srt, .vtt, and plain-text transcripts.",
  },
  {
    question: "Who controls the final cut?",
    answer:
      "You always do. ClipForge highlights candidate clips with transparent scoring and evidence notes, while leaving boundary adjustments, speaker names, hook title selection, accept/reject ratings, and final export choices completely in your hands.",
  },
];
