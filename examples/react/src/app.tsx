import { useCallback, useRef, useState } from "react";
import type { State } from "@taleweaver/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { ModeTabs, type EditorMode } from "@/components/mode-tabs";
import { PrintSurface } from "@/components/print-surface";
import { DigitalSurface } from "@/components/digital-surface";
import { CollabSurface } from "@/components/collab-surface";
import "./app.css";

export function App() {
  // The print/digital fork is DOWNSTREAM of the core `State`: both backends drive
  // the same document, render the same styled tree, and reduce the same
  // `EditorAction`s — they differ only in how they realize the view (print computes
  // pixel geometry → canvas; digital hands the styled tree to the browser to flow).
  // Switching tabs swaps the backend and HANDS THE LIVE DOCUMENT OFF: the active
  // surface's current `State` seeds the incoming one (keyed remount).
  const [mode, setMode] = useState<EditorMode>("print");
  const [handoff, setHandoff] = useState<State | null>(null);

  // The currently-mounted surface registers its live-state getter here on mount;
  // read it at switch time to capture the outgoing document.
  const getStateRef = useRef<(() => State) | null>(null);
  const registerGetState = useCallback((getState: () => State) => {
    getStateRef.current = getState;
  }, []);

  const switchMode = useCallback(
    (next: EditorMode) => {
      if (next === mode) return;
      const live = getStateRef.current?.();
      if (live !== undefined) setHandoff(live);
      setMode(next);
    },
    [mode],
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-white">
        <Header />
        <ModeTabs mode={mode} onChange={switchMode} />
        {mode === "print" ? (
          <PrintSurface key="print" seed={handoff} registerGetState={registerGetState} />
        ) : mode === "digital" ? (
          <DigitalSurface key="digital" seed={handoff} registerGetState={registerGetState} />
        ) : (
          <CollabSurface key="collab" seed={handoff} registerGetState={registerGetState} />
        )}
      </div>
    </TooltipProvider>
  );
}
