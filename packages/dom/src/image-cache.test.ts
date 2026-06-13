import { describe, it, expect, vi } from "vitest";
import { ImageCache } from "./image-cache";

// Mock HTMLImageElement
class MockImage {
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
}

describe("ImageCache", () => {
  it("returns null for an image not yet loaded", () => {
    const onLoad = vi.fn();
    const cache = new ImageCache(onLoad, () => new MockImage() as unknown as HTMLImageElement);
    const result = cache.get("data:image/png;base64,abc");
    expect(result).toBeNull();
  });

  it("returns the image after it loads", () => {
    const onLoad = vi.fn();
    let capturedImg: MockImage | null = null;
    const cache = new ImageCache(onLoad, () => {
      capturedImg = new MockImage();
      return capturedImg as unknown as HTMLImageElement;
    });

    cache.get("data:image/png;base64,abc");
    // Simulate the image loading
    capturedImg!.onload!();

    const result = cache.get("data:image/png;base64,abc");
    expect(result).toBe(capturedImg);
  });

  it("calls onLoad callback when image finishes loading", () => {
    const onLoad = vi.fn();
    let capturedImg: MockImage | null = null;
    const cache = new ImageCache(onLoad, () => {
      capturedImg = new MockImage();
      return capturedImg as unknown as HTMLImageElement;
    });

    cache.get("data:image/png;base64,abc");
    capturedImg!.onload!();

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("does not start duplicate loads for the same src", () => {
    const onLoad = vi.fn();
    const createImage = vi.fn(() => new MockImage() as unknown as HTMLImageElement);
    const cache = new ImageCache(onLoad, createImage);

    cache.get("data:image/png;base64,abc");
    cache.get("data:image/png;base64,abc");

    expect(createImage).toHaveBeenCalledTimes(1);
  });

  it("never attempts a load for an empty src (no per-frame churn)", () => {
    // An empty src has no image to load; the browser fires onerror on `img.src =
    // ""`, which clears the `loading` gate, so without an empty-src guard EVERY
    // render frame would re-create an Image and re-attempt the failed load. A
    // sanitized dangerous <img> decodes to src="" (html-decode F2), so this path
    // is real. Repeated get("") must allocate NO Image.
    const onLoad = vi.fn();
    const createImage = vi.fn(() => new MockImage() as unknown as HTMLImageElement);
    const cache = new ImageCache(onLoad, createImage);

    expect(cache.get("")).toBeNull();
    expect(cache.get("")).toBeNull();
    expect(cache.get("")).toBeNull();

    expect(createImage).not.toHaveBeenCalled();
  });

  it("handles different sources independently", () => {
    const onLoad = vi.fn();
    const imgs: MockImage[] = [];
    const cache = new ImageCache(onLoad, () => {
      const img = new MockImage();
      imgs.push(img);
      return img as unknown as HTMLImageElement;
    });

    cache.get("data:image/png;base64,abc");
    cache.get("data:image/png;base64,def");

    expect(imgs).toHaveLength(2);
  });
});
