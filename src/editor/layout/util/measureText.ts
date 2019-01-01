import TextStyle from '../TextStyle';

class LRUCache {
  queue: string[];
  map: Map<string, any>;
  size: number;

  constructor(size: number) {
    this.queue = [];
    this.map = new Map<string, any>();
    this.size = size;
  }

  set(key: string, value: any) {
    this.map.set(key, value);
    this.queue.unshift(key);
    if (this.queue.length > this.size) {
      this.queue.pop();
      this.map.delete(key);
    }
  }

  get(key: string) {
    if (this.map.has(key)) {
      return this.map.get(key);
    }
    return undefined;
  }
}

type Measurement = {
  width: number;
  height: number;
};

export class TextMeasurer {
  private lruCache: LRUCache;
  private $iframe: HTMLIFrameElement;
  private $textContainers: Map<string, HTMLSpanElement>;

  constructor() {
    // Create LRU cache
    this.lruCache = new LRUCache(500);

    // Create iframe element
    this.$iframe = document.createElement("iframe");
    this.$iframe.src = "about:blank";
    this.$iframe.style.width = "0";
    this.$iframe.style.height = "0";
    this.$iframe.style.border = "none";
    document.body.appendChild(this.$iframe);

    this.$textContainers = new Map<string, HTMLSpanElement>();
  }

  getTextContainerElement(textStyle: TextStyle): HTMLSpanElement {
    if (!this.$textContainers.has(textStyle.getID())) {
      const $textContainer = document.createElement('span');
      $textContainer.style.whiteSpace = 'pre';
      $textContainer.style.fontFamily = textStyle.getFont();
      $textContainer.style.fontSize = textStyle.getSize() + 'px';
      $textContainer.style.fontWeight = textStyle.getWeight() + '';
      this.$iframe.contentDocument!.body.appendChild($textContainer);
      this.$textContainers.set(textStyle.getID(), $textContainer);
    }
    const $textContainer = this.$textContainers.get(textStyle.getID());
    return $textContainer!;
  }

  measure(text: string, textStyle: TextStyle) {
    const cacheKey = JSON.stringify([text, textStyle.getID()]);
    const cachedValue = this.lruCache.get(cacheKey);
    if (cachedValue) {
      return cachedValue;
    }
    const $textContainer = this.getTextContainerElement(textStyle);
    if ($textContainer.innerHTML !== text) {
      $textContainer.innerHTML = text;
    }
    const boundingClientRect = $textContainer.getBoundingClientRect();
    this.lruCache.set(cacheKey, boundingClientRect);
    return {
      width: boundingClientRect.width,
      height: boundingClientRect.height,
    };
  }
}

const textMeasurer = new TextMeasurer();

export default function measureText(text: string, textStyle: TextStyle): Measurement {
  return textMeasurer.measure(text, textStyle);
}
