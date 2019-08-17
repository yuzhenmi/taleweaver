import Editor from '../Editor';
import LineBreakLayoutNode from '../layout/LineBreakLayoutNode';
import InlineViewNode from './InlineViewNode';

export default class LineBreakViewNode extends InlineViewNode<LineBreakLayoutNode> {
    protected domContainer: HTMLSpanElement;

    constructor(editor: Editor, layoutNode: LineBreakLayoutNode) {
        super(editor, layoutNode);
        this.domContainer = document.createElement('span');
        this.domContainer.className = 'tw--line-break-inline';
        this.domContainer.setAttribute('data-tw-id', this.getID());
        this.domContainer.setAttribute('data-tw-role', 'inline');
        this.domContainer.style.display = 'inline-block';
        this.domContainer.style.whiteSpace = 'pre';
        this.domContainer.style.lineHeight = '1em';
        this.domContainer.innerText = ' ';
        this.updateDOM();
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

    protected updateDOM() { }
}
