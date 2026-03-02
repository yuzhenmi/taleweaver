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
