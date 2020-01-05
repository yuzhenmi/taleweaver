import { AtomicLayoutNode } from '../../layout/atomic-node';
import { BlockLayoutNode } from '../../layout/block-node';
import { InlineLayoutNode } from '../../layout/inline-node';
import { ILayoutNode } from '../../layout/node';
import { BlockModelNode } from '../../model/block-node';
import { IAttributes, IModelNode } from '../../model/node';
import { AtomicRenderNode } from '../../render/atomic-node';
import { BlockRenderNode } from '../../render/block-node';
import { InlineRenderNode } from '../../render/inline-node';
import { IRenderNode, IStyle } from '../../render/node';
import { generateId } from '../../util/id';
import { BlockViewNode } from '../../view/block-node';
import { InlineViewNode } from '../../view/inline-node';
import { Component, IComponent } from '../component';

export interface IParagraphAttributes extends IAttributes {}

export class ParagraphModelNode extends BlockModelNode<IParagraphAttributes> {
    getPartId() {
        return 'paragraph';
    }

    toDOM(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const childNode = children[n];
            const childSize = childNode.getSize();
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

    clone() {
        return new ParagraphModelNode(this.componentId, generateId(), this.attributes);
    }
}

export interface IParagraphStyle extends IStyle {}

export class ParagraphRenderNode extends BlockRenderNode<IParagraphStyle> {
    protected lineBreakNode: ParagraphLineBreakRenderNode;

    constructor(protected componentId: string, protected id: string, protected style: IParagraphStyle) {
        super(componentId, id, style);
        this.lineBreakNode = this.buildLineBreakNode();
    }

    getPartId() {
        return 'paragraph';
    }

    getChildren() {
        return [...super.getChildren(), this.lineBreakNode];
    }

    convertOffsetToModelOffset(offset: number): number {
        // Handle line break
        if (offset === this.getSize() - 1) {
            return super.convertOffsetToModelOffset(offset - 1) + 1;
        }
        return super.convertOffsetToModelOffset(offset);
    }

    convertModelOffsetToOffset(modelOffset: number): number {
        // Handle line break
        if (this.getSize() === 1) {
            return 0;
        }
        if (super.convertModelOffsetToOffset(modelOffset - 1) + 1 === this.getSize() - 1) {
            return this.getSize() - 1;
        }
        return super.convertModelOffsetToOffset(modelOffset);
    }

    protected buildLineBreakNode() {
        const inlineNode = new ParagraphLineBreakRenderNode(this.componentId, `${this.id}.line-break`, {});
        const atomicNode = new ParagraphLineBreakAtomicRenderNode(this.componentId, `${this.id}.line-break-atomic`, {});
        inlineNode.appendChild(atomicNode);
        inlineNode.setParent(this);
        return inlineNode;
    }
}

export interface IParagraphLineBreakStyle extends IStyle {}

export class ParagraphLineBreakRenderNode extends InlineRenderNode<IParagraphLineBreakStyle> {
    getPartId() {
        return 'line-break';
    }

    getModelSize() {
        return 0;
    }
}

export interface IParagraphLineBreakAtomicStyle extends IStyle {}

export class ParagraphLineBreakAtomicRenderNode extends AtomicRenderNode<IParagraphLineBreakAtomicStyle> {
    getPartId() {
        return 'line-break-atomic';
    }

    getModelSize() {
        return 0;
    }

    getSize() {
        return 1;
    }

    isBreakable() {
        return true;
    }

    clearOwnCache() {}
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
    buildModelNode(partId: string | undefined, id: string, attributes: {}) {
        return new ParagraphModelNode(this.id, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode) {
        if (modelNode instanceof ParagraphModelNode) {
            return new ParagraphRenderNode(this.id, modelNode.getId(), {});
        }
        throw new Error('Invalid paragraph model node.');
    }

    buildLayoutNode(renderNode: IRenderNode) {
        if (renderNode instanceof ParagraphRenderNode) {
            return new ParagraphLayoutNode(this.id, renderNode.getId());
        }
        if (renderNode instanceof ParagraphLineBreakRenderNode) {
            return new ParagraphLineBreakLayoutNode(this.id, renderNode.getId());
        }
        if (renderNode instanceof ParagraphLineBreakAtomicRenderNode) {
            return new ParagraphLineBreakAtomicLayoutNode(this.id, renderNode.getId());
        }
        throw new Error('Invalid paragraph render node.');
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof ParagraphLayoutNode) {
            return new ParagraphViewNode(layoutNode);
        }
        if (layoutNode instanceof ParagraphLineBreakLayoutNode) {
            return new ParagraphLineBreakViewNode(layoutNode);
        }
        throw new Error('Invalid paragraph layout node.');
    }
}
