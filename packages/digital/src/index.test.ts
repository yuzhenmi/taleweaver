import { describe, it, expect } from "vitest";
import {
  renderDocumentToDom,
  renderNodeToDom,
  computedStyleToInlineStyle,
  createDigitalController,
} from "./index";

describe("@taleweaver/digital barrel", () => {
  it("exports the read-only DOM viewer entry points", () => {
    expect(typeof renderDocumentToDom).toBe("function");
    expect(typeof renderNodeToDom).toBe("function");
    expect(typeof computedStyleToInlineStyle).toBe("function");
  });

  it("exports the contenteditable controller factory", () => {
    expect(typeof createDigitalController).toBe("function");
  });
});
