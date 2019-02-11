import LineView, { LineViewDOMElements, LineViewConfig } from './LineView';

export default class ParagraphLineView extends LineView {
  private domParagraphLine?: HTMLDivElement;
  private mounted: boolean;

  constructor(config: LineViewConfig) {
    super(config);
    this.mounted = false;
  }

  mount() {
    if (this.mounted) {
      return;
    }
    // Get wrapper element
    const { domPageContent } = this.getPageView().getDOM();

    // Build line element
    this.domParagraphLine = document.createElement('div');
    this.domParagraphLine.className = 'tw--paragraph-line';
    domPageContent.appendChild(this.domParagraphLine);

    // Mount word views
    this.wordViews.forEach(wordView => wordView.mount());
  }

  getDOM(): LineViewDOMElements {
    return {
      domLine: this.domParagraphLine!,
      domLineContent: this.domParagraphLine!,
    };
  }
}
