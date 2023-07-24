import { BlockRenderNode } from '../render/nodes/block';
import { DocRenderNode } from '../render/nodes/doc';
import { InlineRenderNode } from '../render/nodes/inline';
import { TextRenderNode } from '../render/nodes/text';
import { TextService } from '../text/service';
import { LayoutNode } from './nodes';
import { BlockLayoutNode, BlockLayoutProps } from './nodes/block';
import { DocLayoutNode } from './nodes/doc';
import { InlineLayoutNode } from './nodes/inline';
import { LineLayoutChildNode, LineLayoutNode, LineLayoutProps } from './nodes/line';
import { PageLayoutChildNode, PageLayoutNode } from './nodes/page';
import { TextLayoutNode } from './nodes/text';
import { WordLayoutNode } from './nodes/token';

interface LayoutNodeWithChildren<TChild extends LayoutNode> {
    children: TChild[];
    setChildren(children: TChild[]): void;
}

export class LayoutTreeManager {
    constructor(protected textService: TextService) {}

    syncWithRenderTree(doc: DocLayoutNode | null, renderDoc: DocRenderNode) {
        return this.syncWithDocRenderNode(doc, renderDoc) as DocLayoutNode;
    }

    protected syncWithDocRenderNode(node: DocLayoutNode | null, renderNode: DocRenderNode) {
        if (!renderNode.needLayout && node) {
            return node;
        }
        if (!node) {
            node = this.buildDocLayoutNode(renderNode.id);
        }
        let pages = node.children;
        const childrenMap: { [key: string]: PageLayoutChildNode[] } = {};
        pages.forEach((page) => {
            const children = page.children;
            children.forEach((child) => {
                childrenMap[child.renderId] = childrenMap[child.renderId] ?? [];
                childrenMap[child.renderId].push(child);
            });
        });
        const renderChildren = renderNode.children;
        const docStyle = renderNode.style;
        const pageContentWidth = docStyle.pageWidth - docStyle.pagePaddingLeft - docStyle.pagePaddingRight;
        const pageContentHeight = docStyle.pageHeight - docStyle.pagePaddingTop - docStyle.pagePaddingBottom;
        const newChildren: PageLayoutChildNode[] = [];
        renderChildren.forEach((renderChild) => {
            newChildren.push(
                ...this.syncWithBlockRenderNode(childrenMap[renderChild.id] ?? [], renderChild, pageContentWidth),
            );
        });
        this.updateChildrenForNodes(pages, newChildren, () => this.buildPageLayoutNode());
        this.reflowPages(pages, pageContentHeight);
        const pageLayoutProps = {
            width: docStyle.pageWidth,
            height: docStyle.pageHeight,
            paddingTop: docStyle.pagePaddingTop,
            paddingBottom: docStyle.pagePaddingBottom,
            paddingLeft: docStyle.pagePaddingLeft,
            paddingRight: docStyle.pagePaddingRight,
        };
        pages.forEach((page) => page.setLayoutProps(pageLayoutProps));
        node.setChildren(pages);
        renderNode.markAsLaidOut();
        return node;
    }

    protected syncWithBlockRenderNode(nodes: BlockLayoutNode[], renderNode: BlockRenderNode, width: number) {
        if (!renderNode.needLayout && nodes.length > 0) {
            return nodes;
        }
        let lines = nodes.reduce((lines, node) => lines.concat(node.children), [] as LineLayoutNode[]);
        const renderChildren = renderNode.children;
        const childrenMap: { [key: string]: LineLayoutChildNode[] } = {};
        lines.forEach((line) => {
            const children = line.children;
            children.forEach((child) => {
                childrenMap[child.renderId] = childrenMap[child.renderId] ?? [];
                childrenMap[child.renderId].push(child);
            });
        });
        const newChildren: LineLayoutChildNode[] = [];
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
        const blockStyle = renderNode.style;
        const blockLayoutProps: BlockLayoutProps = {
            width,
            paddingTop: blockStyle.paddingTop,
            paddingBottom: blockStyle.paddingBottom,
            paddingLeft: blockStyle.paddingLeft,
            paddingRight: blockStyle.paddingRight,
        };
        const lineWidth = blockLayoutProps.width - blockLayoutProps.paddingLeft - blockLayoutProps.paddingRight;
        const lineLayoutProps: LineLayoutProps = {
            width: lineWidth,
            lineHeight: blockStyle.lineHeight,
        };
        this.reflowLines(lines, lineLayoutProps.width);
        lines.forEach((line) => line.setLayoutProps(lineLayoutProps));
        this.updateChildrenForNodes(nodes, lines, () => this.buildBlockLayoutNode(renderNode.id));
        nodes.forEach((node) => node.setLayoutProps(blockLayoutProps));
        renderNode.markAsLaidOut();
        return nodes;
    }

    protected syncWithInlineRenderNode(node: InlineLayoutNode, renderNode: InlineRenderNode) {
        if (!renderNode.needLayout && node) {
            return node;
        }
        if (!node) {
            node = this.buildInlineLayoutNode(renderNode.id);
        }
        node.setLayoutProps(renderNode.style);
        renderNode.markAsLaidOut();
        return node;
    }

    protected syncWithTextRenderNode(nodes: TextLayoutNode[], renderNode: TextRenderNode) {
        if (!renderNode.needLayout && nodes.length > 0) {
            return nodes;
        }
        const childrenMap: { [key: string]: WordLayoutNode[] } = {};
        for (const node of nodes) {
            for (const child of node.children) {
                const key = child.content + new Array(child.whitespaceSize).fill(' ').join('');
                childrenMap[key] = childrenMap[key] ?? [];
                childrenMap[key].push(child);
            }
        }
        const node = this.buildTextLayoutNode(renderNode.id);
        const words = this.textService.breakIntoWords(renderNode.content);
        const newChildren: WordLayoutNode[] = [];
        for (const word of words) {
            let child = childrenMap[word.content + new Array(word.whitespaceSize).fill(' ').join('')]?.shift();
            if (!child) {
                child = this.buildWordLayoutNode();
                child.setContent(word.content);
                child.setWhitespaceSize(word.whitespaceSize);
            }
            child.setLayoutProps(renderNode.style);
            newChildren.push(child);
        }
        node.setChildren(newChildren);
        this.updateChildrenForNodes(nodes, newChildren, () => this.buildTextLayoutNode(renderNode.id));
        nodes.forEach((node) => node.setLayoutProps(renderNode.style));
        renderNode.markAsLaidOut();
        return nodes;
    }

    protected reflowPages(pages: PageLayoutNode[], maxHeight: number) {
        const children = pages.reduce((children, page) => children.concat(page.children), [] as PageLayoutChildNode[]);
        const childrenByPage: PageLayoutChildNode[][] = [];
        let childrenInCurrentPage: PageLayoutChildNode[] = [];
        let heightInCurrentPage = 0;
        while (children.length > 0) {
            let child: PageLayoutChildNode | null = children.shift()!;
            let shouldStartNewPage = false;
            if (heightInCurrentPage + child.layout.height > maxHeight) {
                switch (child.type) {
                    case 'block': {
                        const remainingHeight = maxHeight - heightInCurrentPage;
                        const lines: LineLayoutNode[] = [];
                        let heightOfLines = 0;
                        for (const line of child.children) {
                            if (heightOfLines + line.layout.height > remainingHeight) {
                                shouldStartNewPage = true;
                                break;
                            }
                            lines.push(line);
                            heightOfLines += line.layout.height;
                        }
                        if (lines.length > 0) {
                            const newChild = this.buildBlockLayoutNode(child.renderId);
                            newChild.setLayoutProps(child.layoutProps);
                            newChild.setChildren(child.children.slice(lines.length));
                            child.setChildren(lines);
                            children.unshift(newChild);
                        } else {
                            if (child.children.length > 0) {
                                children.unshift(child);
                            }
                            child = null;
                        }
                        break;
                    }
                }
            }
            if (child) {
                child.markAsReflowed();
                childrenInCurrentPage.push(child);
                heightInCurrentPage += child.layout.height;
            }
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

    protected reflowLines(lines: LineLayoutNode[], maxWidth: number) {
        const children = lines.reduce((children, line) => children.concat(line.children), [] as LineLayoutChildNode[]);
        const childrenByLine: LineLayoutChildNode[][] = [];
        let childrenInCurrentLine: LineLayoutChildNode[] = [];
        let widthInCurrentLine = 0;
        while (children.length > 0) {
            let child: LineLayoutChildNode | null = children.shift()!;
            let shouldStartNewLine = false;
            if (widthInCurrentLine + child.layout.width > maxWidth) {
                switch (child.type) {
                    case 'text': {
                        const remainingWidth = maxWidth - widthInCurrentLine;
                        const words: WordLayoutNode[] = [];
                        let widthOfWords = 0;
                        for (const word of child.children) {
                            if (widthOfWords + word.layout.width > remainingWidth) {
                                shouldStartNewLine = true;
                                break;
                            }
                            words.push(word);
                            widthOfWords += word.layout.width;
                        }
                        if (words.length > 0) {
                            const newChild = this.buildTextLayoutNode(child.renderId);
                            newChild.setLayoutProps(child.layoutProps);
                            newChild.setChildren(child.children.slice(words.length));
                            child.setChildren(words);
                            children.unshift(newChild);
                        } else if (childrenInCurrentLine.length === 0) {
                            const word = child.children[0];
                            const breakpoint = word.convertCoordinatesToPosition(maxWidth, 0);
                            const newChild = this.buildTextLayoutNode(child.renderId);
                            newChild.setLayoutProps(child.layoutProps);
                            const newWord = this.buildWordLayoutNode();
                            newWord.setLayoutProps(word.layoutProps);
                            newWord.setContent(word.content.substring(breakpoint));
                            word.setContent(word.content.substring(0, breakpoint));
                            newChild.setChildren([newWord, ...child.children.slice(1)]);
                            child.setChildren([word]);
                            children.unshift(newChild);
                        } else {
                            if (child.children.length > 0) {
                                children.unshift(child);
                            }
                            child = null;
                        }
                        break;
                    }
                }
            }
            if (child) {
                childrenInCurrentLine.push(child);
                widthInCurrentLine += child.layout.width;
            }
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

    protected compressPageChildren(nodes: PageLayoutChildNode[]) {
        const newNodes: PageLayoutChildNode[] = [];
        let lastNode: PageLayoutChildNode | undefined;
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

    protected compressLineChildren(nodes: LineLayoutChildNode[]) {
        const newNodes: LineLayoutChildNode[] = [];
        let lastNode: LineLayoutChildNode | undefined;
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

    protected updateChildrenForNodes<TChild extends LayoutNode, TNode extends LayoutNodeWithChildren<TChild>>(
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

    protected buildDocLayoutNode(renderId: string) {
        const node = new DocLayoutNode(renderId);
        node.setLayoutProps({});
        return node;
    }

    protected buildPageLayoutNode() {
        const node = new PageLayoutNode();
        node.setLayoutProps({
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
        node.setLayoutProps({
            width: 0,
            paddingTop: 0,
            paddingBottom: 20,
            paddingLeft: 0,
            paddingRight: 0,
        });
        return node;
    }

    protected buildLineLayoutNode() {
        const node = new LineLayoutNode();
        node.setLayoutProps({
            width: 0,
            lineHeight: 0,
        });
        return node;
    }

    protected buildInlineLayoutNode(renderId: string) {
        const node = new InlineLayoutNode(renderId);
        node.setLayoutProps({
            width: 0,
            height: 0,
        });
        return node;
    }

    protected buildTextLayoutNode(renderId: string) {
        const node = new TextLayoutNode(renderId);
        node.setLayoutProps({
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
        node.setLayoutProps({
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

    protected identifyNode(node: LayoutNode) {
        return node.id;
    }
}
