import { IComponentService } from '../component/service';
import { IRenderAtom } from '../render/atom';
import { IRenderBlock } from '../render/block';
import { IRenderDoc } from '../render/doc';
import { IRenderInline } from '../render/inline';
import { IRenderNode } from '../render/node';
import { IRenderText } from '../render/text';
import { LayoutAtom } from './atom';
import { LayoutBlock } from './block';
import { ILayoutDoc, LayoutDoc } from './doc';
import { LayoutInline } from './inline';
import { ILayoutNode } from './node';
import { LayoutText } from './text';
import { TextMeasurer } from './text-measurer';

export interface ILayoutEngine {
    updateDoc(doc: ILayoutDoc, renderDoc: IRenderDoc<any>): void;
    buildDoc(renderDoc: IRenderDoc<any>): ILayoutDoc;
}

export class LayoutEngine implements ILayoutEngine {
    protected textMeasurer = new TextMeasurer();

    constructor(protected componentService: IComponentService) {}

    buildDoc(renderDoc: IRenderDoc<any>) {
        return new LayoutDoc(
            renderDoc.id,
            renderDoc.width,
            renderDoc.height,
            renderDoc.paddingTop,
            renderDoc.paddingBottom,
            renderDoc.paddingLeft,
            renderDoc.paddingRight,
        );
    }

    updateDoc(doc: ILayoutDoc, renderDoc: IRenderDoc<any>) {
        if (!renderDoc.needLayout) {
            return;
        }
        const childrenMap: { [key: string]: ILayoutNode[] } = {};
        doc.children.forEach((page) => {
            page.children.forEach((child) => {
                if (!child.renderId) {
                    throw new Error('Render ID missing on layout node.');
                }
                childrenMap[child.renderId] = childrenMap[child.renderId] || [];
                childrenMap[child.renderId].push(child);
            });
        });
        const newChildren: ILayoutNode[] = [];
        renderDoc.children.forEach((child) => {
            switch (child.type) {
                case 'block':
                    newChildren.push(...this.updateBlock(childrenMap[child.id], child, doc.innerWidth));
                    break;
                default:
                    throw new Error(`Child type ${child.type} is invalid.`);
            }
        });
        // TODO: Reflow pages
    }

    protected updateBlock(blocks: ILayoutNode[], renderBlock: IRenderNode<any>, width: number): ILayoutNode[] {
        if (!renderBlock.needLayout) {
            if (blocks.length === 0) {
                throw new Error('Expected layout block to be available.');
            }
            return blocks;
        }
        const childrenMap: { [key: string]: ILayoutNode[] } = {};
        for (const block of blocks) {
            block.children.forEach((line) => {
                line.children.forEach((child) => {
                    if (!child.renderId) {
                        throw new Error('Render ID missing on layout node.');
                    }
                    childrenMap[child.renderId] = childrenMap[child.renderId] || [];
                    childrenMap[child.renderId].push(child);
                });
            });
        }
        const newChildren: ILayoutNode[] = [];
        renderBlock.children.forEach((child) => {
            switch (child.type) {
                case 'inline':
                    newChildren.push(...this.updateInline(childrenMap[child.id] || [], child));
                    break;
                default:
                    throw new Error(`Child type ${child.type} is invalid.`);
            }
        });
        const block = this.buildBlock(renderBlock, width);
        // TODO: Reflow lines
        return [block];
    }

    protected updateInline(inlines: ILayoutNode[], renderInline: IRenderNode<any>): ILayoutNode[] {
        if (!renderInline.needLayout) {
            if (inlines.length === 0) {
                throw new Error('Expected layout inline to be available.');
            }
            return inlines;
        }
        const childrenMap: { [key: string]: ILayoutNode[] } = {};
        for (const inline of inlines) {
            inline.children.forEach((child) => {
                if (!child.renderId) {
                    throw new Error('Render ID missing on layout node.');
                }
                childrenMap[child.renderId] = childrenMap[child.renderId] || [];
                childrenMap[child.renderId].push(child);
            });
        }
        const newChildren: ILayoutNode[] = [];
        renderInline.children.forEach((child) => {
            switch (child.type) {
                case 'text':
                    newChildren.push(...this.updateText(childrenMap[child.id] || [], child));
                    break;
                case 'atom':
                    newChildren.push(...this.updateAtom(childrenMap[child.id] || [], child));
                    break;
                default:
                    throw new Error(`Child type ${child.type} is invalid.`);
            }
        });
        const inline = this.buildInline(renderInline);
        inline.setChildren(newChildren);
        return [inline];
    }

    protected updateText(texts: ILayoutNode[], renderText: IRenderNode<any>): ILayoutNode[] {
        if (!renderText.needLayout) {
            if (texts.length === 0) {
                throw new Error('Expected layout text to be available.');
            }
            return texts;
        }
        const text = this.buildText(renderText);
        return [text];
    }

    protected updateAtom(atoms: ILayoutNode[], renderAtom: IRenderNode<any>): ILayoutNode[] {
        if (!renderAtom.needLayout) {
            if (atoms.length === 0) {
                throw new Error('Expected layout atom to be available.');
            }
            return atoms;
        }
        const atom = this.buildAtom(renderAtom);
        return [atom];
    }

    protected buildBlock(renderNode: IRenderNode<any>, width: number) {
        if (renderNode.type !== 'block') {
            throw new Error('Expected block.');
        }
        const renderBlock = renderNode as IRenderBlock<any>;
        return new LayoutBlock(
            renderBlock.id,
            width,
            renderBlock.paddingTop,
            renderBlock.paddingBottom,
            renderBlock.paddingLeft,
            renderBlock.paddingRight,
        );
    }

    protected buildInline(renderNode: IRenderNode<any>) {
        if (renderNode.type !== 'inline') {
            throw new Error('Expected inline.');
        }
        const renderInline = renderNode as IRenderInline<any>;
        return new LayoutInline(
            renderInline.id,
            renderInline.paddingTop,
            renderInline.paddingBottom,
            renderInline.paddingLeft,
            renderInline.paddingRight,
        );
    }

    protected buildText(renderNode: IRenderNode<any>) {
        if (renderNode.type !== 'text') {
            throw new Error('Expected text.');
        }
        const renderText = renderNode as IRenderText<any>;
        return new LayoutText(
            renderText.id,
            renderText.children.map((child) => child.text).join(''),
            renderText.font,
            this.textMeasurer,
        );
    }

    protected buildAtom(renderNode: IRenderNode<any>) {
        if (renderNode.type !== 'atom') {
            throw new Error('Expected atom.');
        }
        const renderAtom = renderNode as IRenderAtom<any>;
        return new LayoutAtom(renderAtom.id, renderAtom.width, renderAtom.height);
    }
}
