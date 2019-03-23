import TextStyle from './TextStyle';

type Measurement = {
  width: number;
  height: number;
};

function getTextStyleKey(textStyle: TextStyle): string {
  return JSON.stringify(textStyle);
}

export class TextMeasurer {
  protected $iframe: HTMLIFrameElement;
  protected $textContainers: Map<string, HTMLSpanElement>;

  constructor() {
    this.$iframe = document.createElement('iframe');
    this.$iframe.src = 'about:blank';
    this.$iframe.style.width = '0';
    this.$iframe.style.height = '0';
    this.$iframe.style.border = 'none';
    document.body.appendChild(this.$iframe);
    this.$textContainers = new Map<string, HTMLSpanElement>();
  }

  getTextContainerElement(textStyle: TextStyle): HTMLSpanElement {
    const textStyleKey = getTextStyleKey(textStyle);
    if (!this.$textContainers.has(textStyleKey)) {
      const $textContainer = document.createElement('span');
      $textContainer.style.display = 'inline-block';
      $textContainer.style.whiteSpace = 'pre';
      $textContainer.style.fontFamily = textStyle.fontFamily;
      $textContainer.style.fontSize = `${textStyle.fontSize}px`;
      $textContainer.style.fontWeight = `${textStyle.fontWeight}`;
      $textContainer.style.lineHeight = `${textStyle.lineHeight}px`;
      $textContainer.style.letterSpacing = `${textStyle.letterSpacing}`;
      this.$iframe.contentDocument!.body.appendChild($textContainer);
      this.$textContainers.set(textStyleKey, $textContainer);
    }
    const $textContainer = this.$textContainers.get(textStyleKey);
    return $textContainer!;
  }

  measure(text: string, textStyle: TextStyle) {
    // Substitute trailing new line with space
    const adjustedText = text.replace(/\n$/, ' ');
    const $textContainer = this.getTextContainerElement(textStyle);
    if ($textContainer.innerHTML !== adjustedText) {
      $textContainer.innerHTML = adjustedText;
    }
    const boundingClientRect = $textContainer.getBoundingClientRect();
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
