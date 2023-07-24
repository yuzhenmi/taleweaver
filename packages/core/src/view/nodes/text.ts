import { DOMService } from '../../dom/service';
import { TextLayout } from '../../layout/nodes/text';
import { BaseViewNode } from './base';

export class TextViewNode extends BaseViewNode<TextLayout> {
    readonly type = 'text';
    readonly domContainer: HTMLDivElement;
    readonly domInnerContainer: HTMLDivElement;

    protected internalContent: string = '';

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'text', className: 'text--container' });
        this.domContainer.style.display = 'inline-block';
        this.domInnerContainer = domService.createElement('div', { role: 'text-content', className: 'text--content' });
        this.domInnerContainer.style.display = 'inline';
        this.domContainer.appendChild(this.domInnerContainer);
    }

    get content() {
        return this.internalContent;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.domInnerContainer.innerText = content;
        this.didUpdateEventEmitter.emit({});
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.fontFamily = this.layout.family;
        this.domContainer.style.fontSize = `${this.layout.size}px`;
        this.domContainer.style.letterSpacing = `${this.layout.letterSpacing}px`;
        this.domContainer.style.fontWeight = `${this.layout.weight}`;
        this.domContainer.style.color = this.layout.color;
        this.domContainer.style.textDecoration = this.layout.underline ? 'underline' : '';
        this.domContainer.style.fontStyle = this.layout.italic ? 'italic' : '';
        this.domInnerContainer.style.textDecoration = this.layout.strikethrough ? 'line-through' : '';
    }
}
