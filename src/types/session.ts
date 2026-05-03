/**
 * Multi-screenshot session data model.
 * See docs/superpowers/specs/2026-05-02-multi-screenshot-narrated-bundle-design.md §4.
 */

export interface CaptureMetadata {
  app: string;
  window: string;
  resolution: string;
  scale: string;
  os: string;
  osBuild: string;
  timestamp: string;
  hostname: string;
  username: string;
  locale: string;
  timezone: string;
  displayCount: number;
  primaryDisplay: string;
  colorSpace: string;
  cpu: string;
  memoryGb: string;
  darkMode: boolean;
  battery: string;
  uptime: string;
  activeUrl: string;
  captureWidth: number;
  captureHeight: number;
  captureMethod: string;
  imageSizeKb: number;
}

export interface AudioOffset {
  /** Seconds into audio-master.webm where this segment starts */
  start: number;
  /** Seconds into audio-master.webm where this segment ends; null while still active */
  end: number | null;
}

export interface Screenshot {
  /** Sequence number — assigned at capture time, never reused after delete */
  seq: number;
  /** Full canonical name without extension; used as filename + alt + transcript marker */
  canonicalName: string;
  /** ISO-8601 timestamp of when the capture was taken */
  capturedAt: string;
  /** Position of this segment in audio-master.webm */
  audioOffset: AudioOffset;
  /** User-supplied free-text caption; empty string when unset */
  caption: string;
  /** Transcribed (or hand-edited) text for this segment */
  transcriptSegment: string;
  /** Filename of replacement audio if user re-recorded; null if using audio-master */
  reRecordedAudio: string | null;
  /** Capture metadata at the moment of screenshot */
  metadata: CaptureMetadata;
  /** True when this segment was captured during a network outage */
  offline: boolean;
}

export type ViewMode = "interleaved" | "split";

export interface Session {
  /** Compact timestamp id, e.g. "2026-05-02_14-23-07" */
  id: string;
  /** Absolute path to the session folder under ~/Pictures/VisionPipe/ */
  folder: string;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
  /** Filename of the master audio recording inside the session folder */
  audioFile: string;
  /** Last toggle state; "interleaved" is View B (default), "split" is View A */
  viewMode: ViewMode;
  screenshots: Screenshot[];
  /** Anything spoken AFTER the last screenshot until Copy & Send / session close */
  closingNarration: string;
}
