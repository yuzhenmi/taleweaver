import { createRoot } from "react-dom/client";
import { App } from "./app";

// Wait for fonts (Inter) to load before rendering so the canvas text
// measurer gets accurate glyph widths on first layout.
document.fonts.ready.then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
