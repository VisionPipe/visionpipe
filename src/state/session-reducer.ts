import type { Session, Screenshot, ViewMode } from "../types/session";

export interface SessionState {
  session: Session | null;
}

export const initialState: SessionState = { session: null };

export type SessionAction =
  | { type: "START_SESSION"; session: Session }
  | { type: "END_SESSION" }
  | { type: "APPEND_SCREENSHOT"; screenshot: Screenshot; audioElapsedSec: number }
  | { type: "DELETE_SCREENSHOT"; seq: number }
  | { type: "UPDATE_CAPTION"; seq: number; caption: string }
  | { type: "UPDATE_TRANSCRIPT_SEGMENT"; seq: number; text: string }
  | { type: "APPEND_TO_ACTIVE_SEGMENT"; text: string }
  | { type: "MARK_OFFLINE"; seq: number; offline: boolean }
  | { type: "SET_RE_RECORDED_AUDIO"; seq: number; filename: string | null }
  | { type: "UPDATE_CLOSING_NARRATION"; text: string }
  | { type: "APPEND_TO_CLOSING_NARRATION"; text: string }
  | { type: "TOGGLE_VIEW_MODE" }
  | { type: "SET_VIEW_MODE"; viewMode: ViewMode };

const touch = (s: Session): Session => ({ ...s, updatedAt: new Date().toISOString() });

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "START_SESSION":
      return { session: action.session };

    case "END_SESSION":
      return { session: null };

    case "APPEND_SCREENSHOT": {
      if (!state.session) return state;
      const updated = state.session.screenshots.map((s, i, arr) =>
        i === arr.length - 1 && s.audioOffset.end === null
          ? { ...s, audioOffset: { ...s.audioOffset, end: action.audioElapsedSec } }
          : s
      );
      const next: Screenshot = {
        ...action.screenshot,
        audioOffset: { start: action.audioElapsedSec, end: null },
      };
      return { session: touch({ ...state.session, screenshots: [...updated, next] }) };
    }

    case "DELETE_SCREENSHOT": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.filter(s => s.seq !== action.seq),
        }),
      };
    }

    case "UPDATE_CAPTION": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, caption: action.caption } : s
          ),
        }),
      };
    }

    case "UPDATE_TRANSCRIPT_SEGMENT": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, transcriptSegment: action.text } : s
          ),
        }),
      };
    }

    case "APPEND_TO_ACTIVE_SEGMENT": {
      if (!state.session) return state;
      const screenshots = [...state.session.screenshots];
      if (screenshots.length === 0) {
        return { session: touch({ ...state.session, closingNarration: state.session.closingNarration + action.text }) };
      }
      const last = screenshots[screenshots.length - 1];
      screenshots[screenshots.length - 1] = { ...last, transcriptSegment: last.transcriptSegment + action.text };
      return { session: touch({ ...state.session, screenshots }) };
    }

    case "MARK_OFFLINE": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, offline: action.offline } : s
          ),
        }),
      };
    }

    case "SET_RE_RECORDED_AUDIO": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, reRecordedAudio: action.filename } : s
          ),
        }),
      };
    }

    case "UPDATE_CLOSING_NARRATION": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, closingNarration: action.text }) };
    }

    case "APPEND_TO_CLOSING_NARRATION": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, closingNarration: state.session.closingNarration + action.text }) };
    }

    case "TOGGLE_VIEW_MODE": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          viewMode: state.session.viewMode === "interleaved" ? "split" : "interleaved",
        }),
      };
    }

    case "SET_VIEW_MODE": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, viewMode: action.viewMode }) };
    }

    default:
      return state;
  }
}
