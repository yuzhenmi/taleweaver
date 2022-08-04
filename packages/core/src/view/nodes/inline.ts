import { DOMService } from '../../dom/service';
import { InlineLayout } from '../../layout/nodes/inline';
import { BaseViewNode } from './base';

export class InlineViewNode extends BaseViewNode<InlineLayout> {
    readonly type = 'inline';
    readonly size = 1;
    readonly domContainer: HTMLDivElement;

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'inline', className: 'inline--container' });
        this.domContainer.style.display = 'inline-block';
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
    }
}
