import { IRenderAtom } from '../render/atom';
import { IRenderBlock } from '../render/block';
import { IRenderDoc } from '../render/doc';
import { IRenderNode } from '../render/node';
import { IRenderText } from '../render/text';
import { ITextService } from '../text/service';
import { INodeList } from '../tree/node-list';
import { LayoutAtom } from './atom';
import { LayoutBlock } from './block';
import { ILayoutDoc, LayoutDoc } from './doc';
import { LayoutLine } from './line';
import { ILayoutNode } from './node';
import { LayoutPage } from './page';
import { ILayoutText, LayoutText } from './text';
import { LayoutWord } from './word';

export interface ILayoutEngine {
    updateDoc(doc: ILayoutDoc, renderDoc: IRenderDoc<any, any>): void;
    buildDoc(renderDoc: IRenderDoc<any, any>): ILayoutDoc;
}

export class LayoutEngine implements ILayoutEngine {
    constructor(protected textService: ITextService) {}

    buildDoc(renderDoc: IRenderDoc<any, any>) {
        const doc = new LayoutDoc(
            renderDoc.id,
            renderDoc.width,
            renderDoc.height,
            renderDoc.paddingTop,
            renderDoc.paddingBottom,
            renderDoc.paddingLeft,
            renderDoc.paddingRight,
        );
        this.updateDoc(doc, renderDoc);
        return doc;
    }

    updateDoc(doc: ILayoutDoc, renderDoc: IRenderDoc<any, any>) {
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
        doc.setChildren(
            this.reflowPages(
                doc.children,
                newChildren,
                doc.width,
                doc.height,
                doc.paddingTop,
                doc.paddingBottom,
                doc.paddingLeft,
                doc.paddingRight,
            ),
        );
    }

    protected updateBlock(blocks: ILayoutNode[], renderBlock: IRenderNode<any, any>, width: number): ILayoutNode[] {
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
        renderBlock.children.forEach((renderChild) => {
            switch (renderChild.type) {
                case 'text':
                    newChildren.push(...this.updateText(childrenMap[renderChild.id] || [], renderChild));
                    break;
                case 'atom':
                    newChildren.push(...this.updateAtom(childrenMap[renderChild.id] || [], renderChild));
                    break;
                default:
                    throw new Error(`Child type ${renderChild.type} is invalid.`);
            }
        });
        const block = this.buildBlock(renderBlock, width);
        block.setChildren(this.reflowLines(block.children, newChildren, block.innerWidth));
        return [block];
    }

    protected updateText(texts: ILayoutNode[], renderText: IRenderNode<any, any>): ILayoutNode[] {
        if (!renderText.needLayout) {
            if (texts.length === 0) {
                throw new Error('Expected layout text to be available.');
            }
            return texts;
        }
        const newChildren: ILayoutNode[] = [];
        this.textService.breakIntoWords(renderText.text).forEach((wordText) => {
            newChildren.push(this.buildWord(renderText, wordText));
        });
        const text = this.buildText(renderText);
        text.setChildren(newChildren);
        return [text];
    }

    protected updateAtom(atoms: ILayoutNode[], renderAtom: IRenderNode<any, any>): ILayoutNode[] {
        if (!renderAtom.needLayout) {
            if (atoms.length === 0) {
                throw new Error('Expected layout atom to be available.');
            }
            return atoms;
        }
        const atom = this.buildAtom(renderAtom);
        return [atom];
    }

    protected buildBlock(renderNode: IRenderNode<any, any>, width: number) {
        if (renderNode.type !== 'block') {
            throw new Error('Expected block.');
        }
        const renderBlock = renderNode as IRenderBlock<any, any>;
        return new LayoutBlock(
            renderBlock.id,
            width,
            renderBlock.paddingTop,
            renderBlock.paddingBottom,
            renderBlock.paddingLeft,
            renderBlock.paddingRight,
        );
    }

    protected buildText(renderNode: IRenderNode<any, any>) {
        if (renderNode.type !== 'text') {
            throw new Error('Expected text.');
        }
        const renderText = renderNode as IRenderText<any, any>;
        return new LayoutText(
            renderText.id,
            renderText.paddingTop,
            renderText.paddingBottom,
            renderText.paddingLeft,
            renderText.paddingRight,
            renderText.font,
        );
    }

    protected buildWord(renderNode: IRenderNode<any, any>, word: string) {
        if (renderNode.type !== 'text') {
            throw new Error('Expected text.');
        }
        const renderText = renderNode as IRenderText<any, any>;
        return new LayoutWord(renderText.id, word, renderText.font, this.textService);
    }

    protected buildAtom(renderNode: IRenderNode<any, any>) {
        if (renderNode.type !== 'atom') {
            throw new Error('Expected atom.');
        }
        const renderAtom = renderNode as IRenderAtom<any, any>;
        return new LayoutAtom(renderAtom.id, renderAtom.width, renderAtom.height);
    }

    protected reflowPages(
        pages: INodeList<ILayoutNode>,
        nodes: ILayoutNode[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        nodes = nodes.slice();
        const newPages: ILayoutNode[] = [];
        pages.forEach((page) => {
            let reflowNeeded = false;
            for (let n = 0, nn = page.children.length; n < nn; n++) {
                const child = page.children.at(n);
                if (child.id !== nodes[n].id) {
                    reflowNeeded = true;
                    break;
                }
            }
            if (!reflowNeeded) {
                newPages.push(page);
                return;
            }
            const newPage = new LayoutPage(width, height, paddingTop, paddingBottom, paddingLeft, paddingRight);
            const newChildren: ILayoutNode[] = [];
            let currentHeight = 0;
            // Push whole nodes to page until either no more node or no longer fit
            let node = nodes.shift();
            while (node && currentHeight + node.height <= height) {
                newChildren.push(node);
                currentHeight += node.height;
                node = nodes.shift();
            }
            // If there is remainder node, try to push part of it to page
            if (node) {
                const nodeChildren: ILayoutNode[] = [];
                for (let m = 0, mm = node.children.length; m < mm; m++) {
                    const nodeChild = node.children.at(m);
                    if (currentHeight + nodeChild.height > height) {
                        break;
                    }
                    nodeChildren.push(nodeChild);
                    currentHeight += nodeChild.height;
                }
                if (nodeChildren.length > 0) {
                    switch (node.type) {
                        case 'block':
                            // Split block to two, one to push to this page, other goes back
                            // to list of nodes to process
                            const node1 = new LayoutBlock(
                                node.renderId,
                                width,
                                node.paddingTop,
                                node.paddingBottom,
                                node.paddingLeft,
                                node.paddingRight,
                            );
                            node1.setChildren(nodeChildren);
                            newChildren.push(node1);
                            currentHeight += node1.height;
                            const node2 = new LayoutBlock(
                                node.renderId,
                                width,
                                node.paddingTop,
                                node.paddingBottom,
                                node.paddingLeft,
                                node.paddingRight,
                            );
                            nodes.unshift(node2);
                            break;
                        default:
                            throw new Error('Invalid node type encountered while reflowing page.');
                    }
                }
            }
            newPage.setChildren(newChildren);
            newPages.push(newPage);
        });
        return newPages;
    }

    protected reflowLines(lines: INodeList<ILayoutNode>, nodes: ILayoutNode[], width: number) {
        nodes = nodes.slice();
        const newLines: ILayoutNode[] = [];
        lines.forEach((line) => {
            let reflowNeeded = false;
            for (let n = 0, nn = line.children.length; n < nn; n++) {
                const child = line.children.at(n);
                if (child.id !== nodes[n].id) {
                    reflowNeeded = true;
                    break;
                }
            }
            if (!reflowNeeded) {
                newLines.push(line);
                return;
            }
            const newLine = new LayoutLine(width);
            const newChildren: ILayoutNode[] = [];
            let currentWidth = 0;
            // Push whole nodes to line until either no more node or no longer fit
            let node = nodes.shift();
            while (node && currentWidth + node.width <= width) {
                newChildren.push(node);
                currentWidth += node.width;
                node = nodes.shift();
            }
            // If there is remainder node, try to push part of it to line
            if (node) {
                const nodeChildren: ILayoutNode[] = [];
                for (let m = 0, mm = node.children.length; m < mm; m++) {
                    // TODO: If word is wider than line, break word
                    const nodeChild = node.children.at(m);
                    if (currentWidth + nodeChild.width > width) {
                        break;
                    }
                    nodeChildren.push(nodeChild);
                    currentWidth += nodeChild.width;
                }
                if (nodeChildren.length > 0) {
                    switch (node.type) {
                        case 'text':
                            // Split text to two, one to push to this line, other goes back
                            // to list of nodes to process
                            const text = node as ILayoutText;
                            const node1 = new LayoutText(
                                text.renderId,
                                text.paddingTop,
                                text.paddingBottom,
                                text.paddingLeft,
                                text.paddingRight,
                                text.font,
                            );
                            node1.setChildren(nodeChildren);
                            newChildren.push(node1);
                            currentWidth += node1.width;
                            const node2 = new LayoutText(
                                text.renderId,
                                text.paddingTop,
                                text.paddingBottom,
                                text.paddingLeft,
                                text.paddingRight,
                                text.font,
                            );
                            nodes.unshift(node2);
                            break;
                        case 'atom':
                            // If atom is wider than line and line is empty, push atom to line
                            // and let it clip
                            if (node.width > width && newChildren.length === 0) {
                                newChildren.push(node);
                            } else {
                                // Atom cannot be split, goes back to list of nodes to process
                                nodes.unshift(node);
                            }
                            break;
                        default:
                            throw new Error('Invalid node type encountered while reflowing page.');
                    }
                }
            }
            newLine.setChildren(newChildren);
            newLines.push(newLine);
        });
        return newLines;
    }
}
