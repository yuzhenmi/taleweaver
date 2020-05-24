import { IRenderAtom } from '../render/atom';
import { IRenderBlock } from '../render/block';
import { IRenderDoc } from '../render/doc';
import { IRenderText } from '../render/text';
import { ITextService } from '../text/service';
import { ILayoutAtom, LayoutAtom } from './atom';
import { ILayoutBlock, LayoutBlock } from './block';
import { ILayoutDoc, LayoutDoc } from './doc';
import { ILayoutLine, LayoutLine } from './line';
import { ILayoutNode } from './node';
import { ILayoutPage, LayoutPage } from './page';
import { ILayoutText, LayoutText } from './text';
import { LayoutWord } from './word';

export interface ILayoutEngine {
    updateDoc(doc: ILayoutDoc | null, renderDoc: IRenderDoc<any, any>): ILayoutDoc;
}

export class LayoutEngine implements ILayoutEngine {
    constructor(protected textService: ITextService) {}

    updateDoc(doc: ILayoutDoc | null, renderDoc: IRenderDoc<any, any>) {
        if (!renderDoc.needLayout) {
            if (!doc) {
                throw new Error('Expected doc to be available.');
            }
            return doc;
        }
        const childrenMap: { [key: string]: ILayoutNode[] } = {};
        if (doc) {
            doc.children.forEach((page) => {
                page.children.forEach((child) => {
                    if (!child.renderId) {
                        throw new Error('Render ID missing on layout node.');
                    }
                    childrenMap[child.renderId] = childrenMap[child.renderId] || [];
                    childrenMap[child.renderId].push(child);
                });
            });
        }
        const newChildren: ILayoutNode[] = [];
        renderDoc.children.forEach((child) => {
            switch (child.type) {
                case 'block':
                    newChildren.push(
                        ...this.updateBlock(
                            childrenMap[child.id] as ILayoutBlock[],
                            child as IRenderBlock<any, any>,
                            renderDoc.width - renderDoc.paddingLeft - renderDoc.paddingRight,
                        ),
                    );
                    break;
                default:
                    throw new Error(`Child type ${child.type} is invalid.`);
            }
        });
        renderDoc.clearNeedLayout();
        return this.buildDoc(renderDoc, newChildren);
    }

    protected updateBlock(blocks: ILayoutBlock[], renderBlock: IRenderBlock<any, any>, width: number): ILayoutBlock[] {
        if (!renderBlock.needLayout) {
            if (blocks.length === 0) {
                throw new Error('Expected layout block to be available.');
            }
            return blocks;
        }
        const lines: ILayoutLine[] = [];
        const childrenMap: { [key: string]: ILayoutNode[] } = {};
        for (const block of blocks) {
            block.children.forEach((line) => {
                lines.push(line as ILayoutLine);
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
                    newChildren.push(
                        ...this.updateText(
                            (childrenMap[renderChild.id] as ILayoutText[]) || [],
                            renderChild as IRenderText<any, any>,
                        ),
                    );
                    break;
                case 'atom':
                    newChildren.push(
                        ...this.updateAtom(
                            (childrenMap[renderChild.id] as ILayoutAtom[]) || [],
                            renderChild as IRenderAtom<any, any>,
                        ),
                    );
                    break;
                default:
                    throw new Error(`Child type ${renderChild.type} is invalid.`);
            }
        });
        renderBlock.clearNeedLayout();
        return [
            this.buildBlock(
                renderBlock,
                this.reflowLines(lines, newChildren, width - renderBlock.paddingLeft - renderBlock.paddingRight),
                width,
            ),
        ];
    }

    protected updateText(texts: ILayoutText[], renderText: IRenderText<any, any>): ILayoutText[] {
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
        renderText.clearNeedLayout();
        return [this.buildText(renderText, newChildren)];
    }

    protected updateAtom(atoms: ILayoutAtom[], renderAtom: IRenderAtom<any, any>): ILayoutAtom[] {
        if (!renderAtom.needLayout) {
            if (atoms.length === 0) {
                throw new Error('Expected layout atom to be available.');
            }
            return atoms;
        }
        renderAtom.clearNeedLayout();
        return [this.buildAtom(renderAtom)];
    }

    protected buildDoc(renderDoc: IRenderDoc<any, any>, children: ILayoutNode[]) {
        return new LayoutDoc(
            renderDoc.id,
            children,
            renderDoc.width,
            renderDoc.height,
            renderDoc.paddingTop,
            renderDoc.paddingBottom,
            renderDoc.paddingLeft,
            renderDoc.paddingRight,
        );
    }

    protected buildBlock(renderBlock: IRenderBlock<any, any>, children: ILayoutNode[], width: number) {
        if (renderBlock.type !== 'block') {
            throw new Error('Expected block.');
        }
        return new LayoutBlock(
            renderBlock.id,
            children,
            width,
            renderBlock.paddingTop,
            renderBlock.paddingBottom,
            renderBlock.paddingLeft,
            renderBlock.paddingRight,
        );
    }

    protected buildText(renderText: IRenderText<any, any>, children: ILayoutNode[]) {
        if (renderText.type !== 'text') {
            throw new Error('Expected text.');
        }
        return new LayoutText(
            renderText.id,
            children,
            renderText.paddingTop,
            renderText.paddingBottom,
            renderText.paddingLeft,
            renderText.paddingRight,
            renderText.font,
        );
    }

    protected buildWord(renderText: IRenderText<any, any>, word: string) {
        if (renderText.type !== 'text') {
            throw new Error('Expected text.');
        }
        return new LayoutWord(renderText.id, word, renderText.font, this.textService);
    }

    protected buildAtom(renderAtom: IRenderAtom<any, any>) {
        if (renderAtom.type !== 'atom') {
            throw new Error('Expected atom.');
        }
        return new LayoutAtom(renderAtom.id, renderAtom.width, renderAtom.height);
    }

    protected reflowPages(
        pages: ILayoutPage[],
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
                                nodeChildren,
                                width,
                                node.paddingTop,
                                node.paddingBottom,
                                node.paddingLeft,
                                node.paddingRight,
                            );
                            newChildren.push(node1);
                            currentHeight += node1.height;
                            const node2 = new LayoutBlock(
                                node.renderId,
                                node.children.map((child) => child).slice(nodeChildren.length),
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
            const newPage = new LayoutPage(
                newChildren,
                width,
                height,
                paddingTop,
                paddingBottom,
                paddingLeft,
                paddingRight,
            );
            newPages.push(newPage);
        });
        return newPages;
    }

    protected reflowLines(lines: ILayoutLine[], nodes: ILayoutNode[], width: number) {
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
                                nodeChildren,
                                text.paddingTop,
                                text.paddingBottom,
                                text.paddingLeft,
                                text.paddingRight,
                                text.font,
                            );
                            newChildren.push(node1);
                            currentWidth += node1.width;
                            const node2 = new LayoutText(
                                text.renderId,
                                node.children.map((child) => child).slice(nodeChildren.length),
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
            const newLine = new LayoutLine(newChildren, width);
            newLines.push(newLine);
        });
        return newLines;
    }
}
