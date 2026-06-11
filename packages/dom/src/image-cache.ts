export class ImageCache {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private onLoad: () => void;
  private createImage: () => HTMLImageElement;

  constructor(
    onLoad: () => void,
    createImage: () => HTMLImageElement = () => new Image(),
  ) {
    this.onLoad = onLoad;
    this.createImage = createImage;
  }

  get(src: string): HTMLImageElement | null {
    // An empty src has nothing to load. Without this guard `img.src = ""` fires
    // `onerror` (browsers treat empty-string src as an error), which clears the
    // `loading` gate, so every subsequent render frame would re-create an Image
    // and re-attempt the failed load. A sanitized dangerous <img> decodes to
    // src="" (html-decode F2), so this path is reachable from untrusted input.
    if (src === "") return null;

    const cached = this.cache.get(src);
    if (cached) return cached;

    if (!this.loading.has(src)) {
      this.loading.add(src);
      const img = this.createImage();
      img.onload = () => {
        this.cache.set(src, img);
        this.loading.delete(src);
        this.onLoad();
      };
      img.onerror = () => {
        this.loading.delete(src);
      };
      img.src = src;
    }

    return null;
  }
}
