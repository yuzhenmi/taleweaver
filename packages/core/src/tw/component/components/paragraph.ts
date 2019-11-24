import { Component, IComponent } from 'tw/component/component';
import { BlockModelNode } from 'tw/model/block-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { BlockRenderNode } from 'tw/render/block-node';
import { IInlineRenderNode, InlineRenderNode } from 'tw/render/inline-node';
import { IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';

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
        return new ParagraphModelNode(this.component, generateId(), this.attributes);
    }
}

export interface IParagraphStyle extends IStyle {}

export class ParagraphRenderNode extends BlockRenderNode<IParagraphStyle> {
    getPartId() {
        return 'paragraph';
    }

    setChildren(children: IInlineRenderNode[]) {
        super.setChildren([...children, this.buildLineBreakNode()]);
    }

    protected buildLineBreakNode() {
        const inlineNode = new ParagraphLineBreakRenderNode(this.component, `${this.id}.line-break`, {});
        const atomicNode = new ParagraphLineBreakAtomicRenderNode(this.component, `${this.id}.line-break-atomic`, {});
        inlineNode.setChildren([atomicNode]);
        return inlineNode;
    }
}

export interface IParagraphLineBreakStyle extends IStyle {}

export class ParagraphLineBreakRenderNode extends InlineRenderNode<IParagraphLineBreakStyle> {
    getPartId() {
        return 'line-break';
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
        return 0;
    }
}

export class ParagraphComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: {}): ParagraphModelNode {
        return new ParagraphModelNode(this, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode): ParagraphRenderNode {
        if (!(modelNode instanceof ParagraphModelNode)) {
            throw new Error('Invalid paragraph model node.');
        }
        return new ParagraphRenderNode(this, modelNode.getId(), {});
    }
}
