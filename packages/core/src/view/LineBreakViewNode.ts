import Editor from '../Editor';
import InlineViewNode from './InlineViewNode';

export default class LineBreakViewNode extends InlineViewNode {
    protected domContainer: HTMLSpanElement;

    constructor(editor: Editor, id: string) {
        super(editor, id);
        this.domContainer = document.createElement('span');
        this.domContainer.className = 'tw--line-break-inline';
        this.domContainer.setAttribute('data-tw-id', id);
        this.domContainer.setAttribute('data-tw-role', 'inline');
        this.domContainer.style.display = 'inline-block';
        this.domContainer.style.whiteSpace = 'pre';
        this.domContainer.style.lineHeight = '1em';
        this.domContainer.innerText = ' ';
    }

    getType() {
        return 'LineBreak';
    }

    getSize() {
        return 1;
    }

    clearCache() { }

    getDOMContainer() {
        return this.domContainer;
    }
}
