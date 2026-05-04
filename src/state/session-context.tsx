import { createContext, useContext, useReducer, useEffect, useRef, type Dispatch, type ReactNode } from "react";
import { sessionReducer, initialState, type SessionState, type SessionAction } from "./session-reducer";
import { scheduleSessionWrite } from "./persistence";

interface ContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}

const SessionContext = createContext<ContextValue | null>(null);

const IMMEDIATE_ACTIONS = new Set<SessionAction["type"]>([
  "APPEND_SCREENSHOT",
  "DELETE_SCREENSHOT",
  "SET_RE_RECORDED_AUDIO",
]);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(sessionReducer, initialState);
  const lastActionType = useRef<SessionAction["type"] | null>(null);

  const dispatch: Dispatch<SessionAction> = (action) => {
    lastActionType.current = action.type;
    baseDispatch(action);
  };

  useEffect(() => {
    if (!state.session) return;
    const immediate = lastActionType.current ? IMMEDIATE_ACTIONS.has(lastActionType.current) : false;
    scheduleSessionWrite(state.session, immediate);
  }, [state.session]);

  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): ContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
