export type LandingRoute = "/" | "/app" | "/privacy" | "/terms" | "/contact";

export interface HeroMoment {
  id: string;
  label: string;
  title: string;
  quote: string;
  speaker: string;
  start: string;
  end: string;
  duration: string;
  category: string;
  framing: string;
  timelineOffsetClass: string;
}

export const HERO_MOMENTS: HeroMoment[] = [
  {
    id: "m1",
    label: "01",
    title: "The Unscripted Turn",
    quote:
      "Once feedback drops under two seconds, editors stop playing it safe and start finding the real cut.",
    speaker: "Maya Lin",
    start: "04:12",
    end: "04:58",
    duration: "00:46",
    category: "Podcast",
    framing: "9:16 Vertical",
    timelineOffsetClass: "pos-1",
  },
  {
    id: "m2",
    label: "02",
    title: "Quiet Before the Payoff",
    quote:
      "If the opening four seconds need the previous five minutes to make sense, move the start forward.",
    speaker: "Devon Cole",
    start: "11:08",
    end: "11:49",
    duration: "00:41",
    category: "Education",
    framing: "9:16 Vertical",
    timelineOffsetClass: "pos-2",
  },
  {
    id: "m3",
    label: "03",
    title: "Peak Energy Shift",
    quote:
      "Keep the natural vocal dynamic intact and trim the silence right around the turn.",
    speaker: "Maya Lin",
    start: "19:34",
    end: "20:14",
    duration: "00:40",
    category: "Creator",
    framing: "16:9 Wide",
    timelineOffsetClass: "pos-3",
  },
];

export interface InterludeFrame {
  id: string;
  timecode: string;
  caption: string;
  note: string;
  intensity: "low" | "mid" | "peak";
}

export const INTERLUDE_FRAMES: InterludeFrame[] = [
  {
    id: "f1",
    timecode: "02:18",
    caption: "Setup dialogue",
    note: "Ambient pacing",
    intensity: "low",
  },
  {
    id: "f2",
    timecode: "04:12",
    caption: "Vocal inflection rises",
    note: "Moment surfaced",
    intensity: "peak",
  },
  {
    id: "f3",
    timecode: "07:45",
    caption: "Scene transition",
    note: "Clean pause boundary",
    intensity: "mid",
  },
  {
    id: "f4",
    timecode: "11:08",
    caption: "Core insight lands",
    note: "Standalone arc",
    intensity: "peak",
  },
  {
    id: "f5",
    timecode: "16:22",
    caption: "Visual contrast shift",
    note: "Reaction cue",
    intensity: "mid",
  },
  {
    id: "f6",
    timecode: "19:34",
    caption: "Closing payoff",
    note: "Ready to frame",
    intensity: "peak",
  },
];

export interface UseCaseCategory {
  id: "gaming" | "podcasts" | "education" | "vlogs" | "entertainment";
  name: string;
  hint: string;
  timecode: string;
  duration: string;
}

export const COMPACT_USE_CASES: UseCaseCategory[] = [
  {
    id: "gaming",
    name: "Gaming",
    hint: "Reaction peaks · Clutch turns",
    timecode: "01:42:18",
    duration: "00:28",
  },
  {
    id: "podcasts",
    name: "Podcasts",
    hint: "Speaker turns · Sharp takeaways",
    timecode: "00:34:10",
    duration: "00:52",
  },
  {
    id: "education",
    name: "Education",
    hint: "Clear explanations · Clean bounds",
    timecode: "00:18:04",
    duration: "00:44",
  },
  {
    id: "vlogs",
    name: "Vlogs",
    hint: "Story beats · Vertical framing",
    timecode: "00:11:29",
    duration: "00:36",
  },
  {
    id: "entertainment",
    name: "Entertainment",
    hint: "Rhythm shifts · Memorable lines",
    timecode: "00:53:41",
    duration: "00:39",
  },
];
