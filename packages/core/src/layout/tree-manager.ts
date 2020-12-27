import { IBlockRenderNode, IDocRenderNode, IInlineRenderNode, ITextRenderNode } from '../render/node';
import { ITextService } from '../text/service';
import { testDeepEquality } from '../util/compare';
import {
    BlockLayoutNode,
    DocLayoutNode,
    IBlockLayoutNode,
    IBlockStyle,
    IDocLayoutNode,
    IInlineLayoutNode,
    ILayoutNode,
    ILineLayoutNode,
    ILineLayoutNodeChild,
    ILineStyle,
    InlineLayoutNode,
    IPageLayoutNode,
    IPageLayoutNodeChild,
    ITextLayoutNode,
    IWordLayoutNode,
    LineLayoutNode,
    PageLayoutNode,
    TextLayoutNode,
    WordLayoutNode,
} from './node';

interface ILayoutNodeWithChildren<TChild extends ILayoutNode> {
    children: TChild[];
    setChildren(children: TChild[]): void;
}

export class LayoutTreeManager {
    protected doc: IDocLayoutNode | null = null;

    constructor(protected textService: ITextService) {}

    syncWithRenderTree(renderDoc: IDocRenderNode) {
        this.doc = this.syncWithDocRenderNode(this.doc, renderDoc) as IDocLayoutNode;
        return this.doc;
    }

    protected syncWithDocRenderNode(node: IDocLayoutNode | null, renderNode: IDocRenderNode) {
        if (!renderNode.needLayout && node) {
            return node;
        }
        if (!node) {
            node = this.buildDocLayoutNode(renderNode.id);
        }
        let pages = node.children;
        const childrenMap: { [key: string]: IPageLayoutNodeChild[] } = {};
        pages.forEach((page) => {
            const children = page.children;
            children.forEach((child) => {
                childrenMap[child.renderId] = childrenMap[child.renderId] ?? [];
                childrenMap[child.renderId].push(child);
            });
        });
        const renderChildren = renderNode.children;
        const docRenderStyle = renderNode.style;
        const pageContentWidth =
            docRenderStyle.pageWidth - docRenderStyle.pagePaddingLeft - docRenderStyle.pagePaddingRight;
        const newChildren: IPageLayoutNodeChild[] = [];
        renderChildren.forEach((renderChild) => {
            newChildren.push(
                ...this.syncWithBlockRenderNode(childrenMap[renderChild.id] ?? [], renderChild, pageContentWidth),
            );
        });
        this.updateChildrenForNodes(pages, newChildren, () => this.buildPageLayoutNode());
        this.reflowPages(pages, pageContentWidth);
        const pageStyle = {
            width: docRenderStyle.pageWidth,
            height: docRenderStyle.pageHeight,
            paddingTop: docRenderStyle.pagePaddingTop,
            paddingBottom: docRenderStyle.pagePaddingBottom,
            paddingLeft: docRenderStyle.pagePaddingLeft,
            paddingRight: docRenderStyle.pagePaddingRight,
        };
        pages.forEach((page) => this.updateStyleIfNeeded(page, pageStyle));
        node.setChildren(pages);
        this.updateStyleIfNeeded(node, {}); // No style for doc yet
        renderNode.markAsLaidOut();
        return node;
    }

    protected syncWithBlockRenderNode(nodes: IBlockLayoutNode[], renderNode: IBlockRenderNode, width: number) {
        if (!renderNode.needLayout && nodes.length > 0) {
            return nodes;
        }
        let lines = nodes.reduce((lines, node) => lines.concat(node.children), [] as ILineLayoutNode[]);
        const renderChildren = renderNode.children;
        const childrenMap: { [key: string]: ILineLayoutNodeChild[] } = {};
        lines.forEach((line) => {
            const children = line.children;
            children.forEach((child) => {
                childrenMap[child.renderId] = childrenMap[child.renderId] ?? [];
                childrenMap[child.renderId].push(child);
            });
        });
        const newChildren: ILineLayoutNodeChild[] = [];
        renderChildren.forEach((renderChild) => {
            switch (renderChild.type) {
                case 'inline':
                    newChildren.push(
                        this.syncWithInlineRenderNode(
                            childrenMap[renderChild.id].length > 0 ? (childrenMap[renderChild.id][0] as any) : null,
                            renderChild,
                        ),
                    );
                    break;
                case 'text':
                    newChildren.push(
                        ...this.syncWithTextRenderNode((childrenMap[renderChild.id] as any) ?? [], renderChild),
                    );
                    break;
            }
        });
        this.updateChildrenForNodes(lines, newChildren, () => this.buildLineLayoutNode());
        const blockRenderStyle = renderNode.style;
        const blockStyle: IBlockStyle = {
            width,
            paddingTop: blockRenderStyle.paddingTop,
            paddingBottom: blockRenderStyle.paddingBottom,
            paddingLeft: blockRenderStyle.paddingLeft,
            paddingRight: blockRenderStyle.paddingRight,
        };
        const lineWidth = blockStyle.width - blockStyle.paddingLeft - blockStyle.paddingRight;
        const lineStyle: ILineStyle = {
            width: lineWidth,
            lineHeight: blockRenderStyle.lineHeight,
        };
        this.reflowLines(lines, lineStyle.width);
        lines.forEach((line) => this.updateStyleIfNeeded(line, lineStyle));
        this.updateChildrenForNodes(nodes, lines, () => this.buildBlockLayoutNode(renderNode.id));
        nodes.forEach((node) => this.updateStyleIfNeeded(node, blockStyle));
        renderNode.markAsLaidOut();
        return nodes;
    }

    protected syncWithInlineRenderNode(node: IInlineLayoutNode, renderNode: IInlineRenderNode) {
        if (!renderNode.needLayout && node) {
            return node;
        }
        if (!node) {
            node = this.buildInlineLayoutNode(renderNode.id);
        }
        this.updateStyleIfNeeded(node, renderNode.style);
        renderNode.markAsLaidOut();
        return node;
    }

    protected syncWithTextRenderNode(nodes: ITextLayoutNode[], renderNode: ITextRenderNode) {
        if (!renderNode.needLayout && nodes.length > 0) {
            return nodes;
        }
        const childrenMap: { [key: string]: IWordLayoutNode[] } = {};
        for (const node of nodes) {
            for (const child of node.children) {
                const key = child.content + new Array(child.whitespaceSize).fill(' ').join('');
                childrenMap[key] = childrenMap[key] ?? [];
                childrenMap[key].push(child);
            }
        }
        const node = this.buildTextLayoutNode(renderNode.id);
        const words = this.textService.breakIntoWords(renderNode.content);
        const newChildren: IWordLayoutNode[] = [];
        for (const word of words) {
            let child = childrenMap[word.content + new Array(word.whitespaceSize).fill(' ').join('')]?.shift();
            if (!child) {
                child = this.buildWordLayoutNode();
                child.setContent(word.content);
                child.setWhitespaceSize(word.whitespaceSize);
            }
            this.updateStyleIfNeeded(child, renderNode.style);
            newChildren.push(child);
        }
        node.setChildren(newChildren);
        this.updateChildrenForNodes(nodes, newChildren, () => this.buildTextLayoutNode(renderNode.id));
        nodes.forEach((node) => this.updateStyleIfNeeded(node, renderNode.style));
        renderNode.markAsLaidOut();
        return nodes;
    }

    protected reflowPages(pages: IPageLayoutNode[], maxHeight: number) {
        const children = pages.reduce((children, page) => children.concat(page.children), [] as IPageLayoutNodeChild[]);
        const childrenByPage: IPageLayoutNodeChild[][] = [];
        let childrenInCurrentPage: IPageLayoutNodeChild[] = [];
        let heightInCurrentPage = 0;
        while (children.length > 0) {
            const child = children.shift()!;
            let shouldStartNewPage = false;
            if (heightInCurrentPage + child.height > maxHeight) {
                switch (child.type) {
                    case 'block': {
                        const remainingHeight = maxHeight - heightInCurrentPage;
                        const lines: ILineLayoutNode[] = [];
                        let heightOfLines = 0;
                        for (const line of child.children) {
                            if (heightOfLines + line.height > remainingHeight && heightInCurrentPage > 0) {
                                shouldStartNewPage = true;
                                break;
                            }
                            lines.push(line);
                            heightOfLines += line.height;
                        }
                        if (lines.length > 0) {
                            const newChild = this.buildBlockLayoutNode(child.renderId);
                            newChild.setStyle(child.style);
                            newChild.setChildren(child.children.slice(lines.length));
                            child.setChildren(lines);
                            children.unshift(newChild);
                        }
                        break;
                    }
                }
            }
            child.markAsReflowed();
            childrenInCurrentPage.push(child);
            heightInCurrentPage += child.height;
            if (shouldStartNewPage) {
                childrenByPage.push(this.compressPageChildren(childrenInCurrentPage));
                childrenInCurrentPage = [];
                heightInCurrentPage = 0;
            }
        }
        if (childrenInCurrentPage.length > 0) {
            childrenByPage.push(this.compressPageChildren(childrenInCurrentPage));
        }
        if (pages.length > childrenByPage.length) {
            for (let n = 0, nn = pages.length - childrenByPage.length; n < nn; n++) {
                pages.pop();
            }
        } else if (pages.length < childrenByPage.length) {
            for (let n = 0, nn = childrenByPage.length - pages.length; n < nn; n++) {
                pages.push(this.buildPageLayoutNode());
            }
        }
        for (let n = 0, nn = pages.length; n < nn; n++) {
            const page = pages[n];
            page.setChildren(childrenByPage[n]);
            page.markAsReflowed();
        }
    }

    protected reflowLines(lines: ILineLayoutNode[], maxWidth: number) {
        const children = lines.reduce((children, line) => children.concat(line.children), [] as ILineLayoutNodeChild[]);
        const childrenByLine: ILineLayoutNodeChild[][] = [];
        let childrenInCurrentLine: ILineLayoutNodeChild[] = [];
        let widthInCurrentLine = 0;
        while (children.length > 0) {
            const child = children.shift()!;
            let shouldStartNewLine = false;
            if (widthInCurrentLine + child.width > maxWidth) {
                switch (child.type) {
                    case 'text': {
                        const remainingWidth = maxWidth - widthInCurrentLine;
                        const words: IWordLayoutNode[] = [];
                        let widthOfWords = 0;
                        for (const word of child.children) {
                            if (widthOfWords + word.width > remainingWidth && widthInCurrentLine > 0) {
                                shouldStartNewLine = true;
                                break;
                            }
                            words.push(word);
                            widthOfWords += word.width;
                        }
                        if (words.length > 0) {
                            const newChild = this.buildTextLayoutNode(child.renderId);
                            newChild.setStyle(child.style);
                            newChild.setChildren(child.children.slice(words.length));
                            child.setChildren(words);
                            children.unshift(newChild);
                        } else if (childrenInCurrentLine.length === 0) {
                            const word = child.children[0];
                            const breakpoint = word.convertCoordinatesToPosition(maxWidth, 0);
                            const newChild = this.buildTextLayoutNode(child.renderId);
                            newChild.setStyle(child.style);
                            const newWord = this.buildWordLayoutNode();
                            newWord.setStyle(word.style);
                            newWord.setContent(word.content.substring(breakpoint));
                            word.setContent(word.content.substring(0, breakpoint));
                            newChild.setChildren([newWord, ...child.children.slice(1)]);
                            child.setChildren([word]);
                            children.unshift(newChild);
                        }
                        break;
                    }
                }
            }
            childrenInCurrentLine.push(child);
            widthInCurrentLine += child.height;
            if (shouldStartNewLine) {
                childrenByLine.push(this.compressLineChildren(childrenInCurrentLine));
                childrenInCurrentLine = [];
                widthInCurrentLine = 0;
            }
        }
        if (childrenInCurrentLine.length > 0) {
            childrenByLine.push(this.compressLineChildren(childrenInCurrentLine));
        }
        if (lines.length > childrenByLine.length) {
            for (let n = 0, nn = lines.length - childrenByLine.length; n < nn; n++) {
                lines.pop();
            }
        } else if (lines.length < childrenByLine.length) {
            for (let n = 0, nn = childrenByLine.length - lines.length; n < nn; n++) {
                lines.push(this.buildLineLayoutNode());
            }
        }
        for (let n = 0, nn = lines.length; n < nn; n++) {
            const line = lines[n];
            line.setChildren(childrenByLine[n]);
            line.markAsReflowed();
        }
    }

    protected compressPageChildren(nodes: IPageLayoutNodeChild[]) {
        const newNodes: IPageLayoutNodeChild[] = [];
        let lastNode: IPageLayoutNodeChild | undefined;
        for (const node of nodes) {
            if (lastNode?.renderId === node.renderId) {
                lastNode.setChildren([...lastNode.children, ...node.children]);
            } else {
                lastNode = node;
                newNodes.push(node);
            }
        }
        return newNodes;
    }

    protected compressLineChildren(nodes: ILineLayoutNodeChild[]) {
        const newNodes: ILineLayoutNodeChild[] = [];
        let lastNode: ILineLayoutNodeChild | undefined;
        for (const node of nodes) {
            switch (node.type) {
                case 'text': {
                    if (lastNode?.type === 'text' && lastNode?.renderId === node.renderId) {
                        lastNode.setChildren([...lastNode.children, ...node.children]);
                    } else {
                        lastNode = node;
                        newNodes.push(node);
                    }
                    break;
                }
                default: {
                    lastNode = node;
                    newNodes.push(node);
                }
            }
        }
        return newNodes;
    }

    protected updateChildrenForNodes<TChild extends ILayoutNode, TNode extends ILayoutNodeWithChildren<TChild>>(
        nodes: Array<TNode>,
        newChildren: TChild[],
        buildNode: () => TNode,
    ) {
        if (nodes.length === 0) {
            nodes.push(buildNode());
        }
        let newChildrenIndex = 0;
        for (const node of nodes) {
            const nodeChildren = node.children;
            const newNodeChildren: TChild[] = [];
            let nodeChildrenIndex = 0;
            while (nodeChildrenIndex < nodeChildren.length) {
                const nodeChild = nodeChildren[nodeChildrenIndex];
                const nodeChildInNewChildrenIndex = newChildren.findIndex((newChild) => newChild.id === nodeChild.id);
                if (nodeChildInNewChildrenIndex === newChildrenIndex) {
                    newNodeChildren.push(nodeChild);
                    nodeChildrenIndex++;
                    newChildrenIndex++;
                } else if (nodeChildInNewChildrenIndex > newChildrenIndex) {
                    newNodeChildren.push(newChildren[newChildrenIndex]);
                    newChildrenIndex++;
                } else {
                    nodeChildrenIndex++;
                }
            }
            node.setChildren(newNodeChildren);
        }
        if (newChildrenIndex < newChildren.length) {
            const node = nodes[nodes.length - 1];
            node.setChildren([...node.children, ...newChildren.slice(newChildrenIndex)]);
        }
    }

    protected updateStyleIfNeeded(node: ILayoutNode, style: any) {
        const currentStyle = node.style;
        if (!testDeepEquality(currentStyle, style)) {
            node.setStyle(style);
        }
    }

    protected buildDocLayoutNode(renderId: string) {
        const node = new DocLayoutNode(renderId);
        node.setStyle({
            pageWidth: 0,
            pageHeight: 0,
            pagePaddingTop: 0,
            pagePaddingBottom: 0,
            pagePaddingLeft: 0,
            pagePaddingRight: 0,
        });
        return node;
    }

    protected buildPageLayoutNode() {
        const node = new PageLayoutNode();
        node.setStyle({
            width: 0,
            height: 0,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            paddingRight: 0,
        });
        return node;
    }

    protected buildBlockLayoutNode(renderId: string) {
        const node = new BlockLayoutNode(renderId);
        node.setStyle({
            width: 0,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            paddingRight: 0,
        });
        return node;
    }

    protected buildLineLayoutNode() {
        const node = new LineLayoutNode();
        node.setStyle({
            width: 0,
            lineHeight: 0,
        });
        return node;
    }

    protected buildInlineLayoutNode(renderId: string) {
        const node = new InlineLayoutNode(renderId);
        node.setStyle({
            width: 0,
            height: 0,
        });
        return node;
    }

    protected buildTextLayoutNode(renderId: string) {
        const node = new TextLayoutNode(renderId);
        node.setStyle({
            weight: 400,
            size: 14,
            family: 'sans-serif',
            letterSpacing: 0,
            underline: false,
            italic: false,
            strikethrough: false,
            color: 'black',
        });
        return node;
    }

    protected buildWordLayoutNode() {
        const node = new WordLayoutNode(this.textService);
        node.setStyle({
            weight: 400,
            size: 14,
            family: 'sans-serif',
            letterSpacing: 0,
            underline: false,
            italic: false,
            strikethrough: false,
            color: 'black',
        });
        return node;
    }

    protected identifyNode(node: ILayoutNode) {
        return node.id;
    }
}
