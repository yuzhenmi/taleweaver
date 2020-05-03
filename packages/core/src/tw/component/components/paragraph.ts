import { AtomicLayoutNode } from '../../layout/atomic-node';
import { BlockLayoutNode } from '../../layout/block-node';
import { InlineLayoutNode } from '../../layout/inline-node';
import { ILayoutNode } from '../../layout/node';
import { ModelBranch } from '../../model/branch';
import { IModelNode } from '../../model/node';
import { RenderAtom } from '../../render/atom';
import { RenderBlock } from '../../render/block';
import { RenderInline } from '../../render/inline';
import { IRenderNode } from '../../render/node';
import { BlockViewNode } from '../../view/block-node';
import { InlineViewNode } from '../../view/inline-node';
import { IViewNode } from '../../view/node';
import { Component, IComponent } from '../component';

export interface IParagraphAttributes {}

export interface IParagraphStyle {}

export interface IRenderParagraphLineBreakStyle {}

export interface IRenderParagraphLineBreakAtomStyle {}

export class ModelParagraph extends ModelBranch<IParagraphAttributes> {
    get partId() {
        return 'paragraph';
    }

    toDOM(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const children = this.children;
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const childNode = children.at(n);
            const childSize = childNode.size;
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = childNode.toDOM(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}

export class RenderParagraph extends RenderBlock<IParagraphStyle> {
    constructor(componentId: string, id: string, style: IParagraphStyle, children: IRenderNode<any>[]) {
        super(componentId, id, style, children);
        this.onDidReplaceChildren(() => {
            this.appendChild(this.buildLineBreakNode());
        });
    }

    get partId() {
        return 'paragraph';
    }

    get padModelSize() {
        return true;
    }

    protected buildLineBreakNode() {
        return new RenderParagraphLineBreak(this.componentId, `${this.id}.line-break`, {});
    }
}

export class RenderParagraphLineBreak extends RenderInline<IRenderParagraphLineBreakStyle> {
    constructor(componentId: string, id: string, style: IParagraphStyle) {
        super(componentId, id, style, []);
        this.appendChild(this.buildAtom());
    }

    get partId() {
        return 'line-break';
    }

    get padModelSize() {
        return false;
    }

    protected buildAtom() {
        return new RenderParagraphLineBreakAtom(this.componentId, `${this.id}.line-break-atom`, {});
    }
}

export class RenderParagraphLineBreakAtom extends RenderAtom<IRenderParagraphLineBreakAtomStyle> {
    constructor(componentId: string, id: string, style: IRenderParagraphLineBreakAtomStyle) {
        super(componentId, id, style, true);
    }

    get partId() {
        return 'line-break-atom';
    }

    get padModelSize() {
        return false;
    }
}

export class ParagraphLayoutNode extends BlockLayoutNode {
    getPartId() {
        return 'paragraph';
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 12;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    clone() {
        return new ParagraphLayoutNode(this.componentId, this.id);
    }
}

export class ParagraphLineBreakLayoutNode extends InlineLayoutNode {
    getPartId() {
        return 'line-break';
    }

    getPaddingTop() {
        const previousSibling = this.getPreviousSibling() as ILayoutNode | undefined;
        if (!previousSibling) {
            return 0;
        }
        return previousSibling.getPaddingTop();
    }

    getPaddingBottom() {
        const previousSibling = this.getPreviousSibling() as ILayoutNode | undefined;
        if (!previousSibling) {
            return 0;
        }
        return previousSibling.getPaddingBottom();
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    clone() {
        return new ParagraphLineBreakLayoutNode(this.componentId, this.id);
    }
}

export class ParagraphLineBreakAtomicLayoutNode extends AtomicLayoutNode {
    protected height?: number;

    getPartId() {
        return 'line-break-atomic';
    }

    getSize() {
        return 1;
    }

    getWidth() {
        return 5;
    }

    getHeight() {
        if (this.height === undefined) {
            this.takeMeasurement();
        }
        return this.height!;
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 0;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    getTailTrimmedWidth() {
        return 0;
    }

    breakAtWidth(width: number): ParagraphLineBreakAtomicLayoutNode {
        throw new Error('Method should never be called, there is a bug.');
    }

    convertCoordinateToOffset(x: number) {
        return 0;
    }

    resolveRects(from: number, to: number) {
        if (from === to) {
            return [
                {
                    left: 0,
                    right: this.getWidth(),
                    top: 0,
                    bottom: 0,
                    width: 0,
                    height: this.getHeight(),
                    paddingTop: 0,
                    paddingBottom: 0,
                    paddingLeft: 0,
                    paddingRight: 0,
                },
            ];
        }
        return [
            {
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                width: this.getWidth(),
                height: this.getHeight(),
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
            },
        ];
    }

    protected takeMeasurement() {
        this.height = 0;
        const previousSibling = this.getPreviousSiblingAllowCrossParent() as ILayoutNode | undefined;
        if (!previousSibling) {
            return;
        }
        this.height = previousSibling.getHeight();
    }
}

export class ParagraphViewNode extends BlockViewNode<ParagraphLayoutNode> {
    protected domContainer: HTMLDivElement;

    constructor(layoutNode: ParagraphLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }

    onLayoutDidUpdate() {
        this.domContainer.style.width = `${this.layoutNode.getWidth()}px`;
        this.domContainer.style.height = `${this.layoutNode.getHeight()}px`;
        this.domContainer.style.paddingTop = `${this.layoutNode.getPaddingTop()}px`;
        this.domContainer.style.paddingBottom = `${this.layoutNode.getPaddingBottom()}px`;
        this.domContainer.style.paddingLeft = `${this.layoutNode.getPaddingLeft()}px`;
        this.domContainer.style.paddingRight = `${this.layoutNode.getPaddingRight()}px`;
        this.domContainer.style.lineHeight = '1em';
    }
}

export class ParagraphLineBreakViewNode extends InlineViewNode<ParagraphLineBreakLayoutNode> {
    protected domContainer: HTMLDivElement;

    constructor(layoutNode: ParagraphLineBreakLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }

    onLayoutDidUpdate() {}
}

export class ParagraphComponent extends Component implements IComponent {
    buildModelNode(partId: string | null, id: string, attributes: {}, children: IModelNode<any>[], text: string) {
        return new ModelParagraph(this.id, id, attributes, children, '');
    }

    buildRenderNode(modelNode: IModelNode<any>, children: IRenderNode<any>[]) {
        if (modelNode instanceof ModelParagraph) {
            return new RenderParagraph(this.id, modelNode.id, {}, children);
        }
        throw new Error('Invalid paragraph model node.');
    }

    buildLayoutNode(renderNode: IRenderNode<any>, children: ILayoutNode<any>[]) {
        if (renderNode instanceof RenderParagraph) {
            return new ParagraphLayoutNode(this.id, renderNode.id);
        }
        if (renderNode instanceof RenderParagraphLineBreak) {
            return new ParagraphLineBreakLayoutNode(this.id, renderNode.id);
        }
        if (renderNode instanceof RenderParagraphLineBreakAtom) {
            return new ParagraphLineBreakAtomicLayoutNode(this.id, renderNode.id);
        }
        throw new Error('Invalid paragraph render node.');
    }

    buildViewNode(layoutNode: ILayoutNode<any>, children: IViewNode<any>[]) {
        if (layoutNode instanceof ParagraphLayoutNode) {
            return new ParagraphViewNode(layoutNode);
        }
        if (layoutNode instanceof ParagraphLineBreakLayoutNode) {
            return new ParagraphLineBreakViewNode(layoutNode);
        }
        throw new Error('Invalid paragraph layout node.');
    }
}
