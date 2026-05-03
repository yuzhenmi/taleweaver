import { describe, it, expect } from "vitest";
import { text, embed } from "./state-builders";

describe("text helper", () => {
  it("produces a TextItem with the given string and attrs", () => {
    const t = text("hello", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hello");
    expect(t.attrs).toEqual({ bold: true });
  });

  it("defaults attrs to empty bag", () => {
    const t = text("hi");
    expect(t.attrs).toEqual({});
  });
});

describe("embed helper", () => {
  it("produces an EmbedItem with the given type, properties, and attrs", () => {
    const e = embed("image", { src: "u" }, { link: "http://x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "u" });
    expect(e.attrs).toEqual({ link: "http://x" });
  });

  it("defaults properties and attrs to empty", () => {
    const e = embed("hard-break");
    expect(e.properties).toEqual({});
    expect(e.attrs).toEqual({});
  });
});
