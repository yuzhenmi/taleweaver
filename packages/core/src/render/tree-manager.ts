import { IComponentService } from '../component/service';
import { IMark } from '../mark/mark';
import { IMarkService } from '../mark/service';
import {
    IBlockModelNode,
    IDocModelNode,
    IInlineModelNode,
    IModelNode,
} from '../model/node';
import { testDeepEquality } from '../util/compare';
import {
    BlockRenderNode,
    DocRenderNode,
    IBlockRenderNode,
    IBlockRenderNodeChild,
    IDocRenderNode,
    IDocRenderNodeChild,
    IInlineRenderNode,
    InlineRenderNode,
    IRenderNode,
    ITextRenderNode,
    TextRenderNode,
} from './node';

export class RenderTreeManager {
    protected doc: IDocRenderNode | null = null;

    constructor(
        protected componentService: IComponentService,
        protected markService: IMarkService,
    ) {}

    syncWithModelTree(modelDoc: IDocModelNode) {
        this.doc = this.syncWithModelNode(
            this.doc,
            modelDoc,
            null,
        ) as IDocRenderNode;
        return this.doc;
    }

    protected syncWithModelNode(
        node: IRenderNode | null,
        modelNode: IModelNode,
        parentNode: IRenderNode | null,
    ) {
        if (!modelNode.needRender && node) {
            return node;
        }
        let updatedNode: IRenderNode;
        if (modelNode.type === 'doc' && (!node || node.type === 'doc')) {
            updatedNode = this.syncWithDocModelNode(node, modelNode);
        } else if (
            modelNode.type === 'block' &&
            (!node || node.type === 'block')
        ) {
            updatedNode = this.syncWithBlockModelNode(node, modelNode);
        } else if (
            modelNode.type === 'inline' &&
            (!node || node.type === 'inline')
        ) {
            updatedNode = this.syncWithInlineModelNode(node, modelNode);
        } else {
            throw new Error('Invalid render and model node pair for syncing.');
        }
        this.syncStyleWithModelNode(updatedNode, modelNode);
        modelNode.markAsRendered();
        return updatedNode;
    }

    protected syncWithDocModelNode(
        node: IDocRenderNode | null,
        modelNode: IDocModelNode,
    ) {
        if (!node) {
            node = new DocRenderNode(modelNode.id);
            node.setStyle({
                pageWidth: 0,
                pageHeight: 0,
                pagePaddingTop: 0,
                pagePaddingBottom: 0,
                pagePaddingLeft: 0,
                pagePaddingRight: 0,
            });
        }
        const children = node.children;
        const modelChildren = modelNode.children;
        const childrenMap: { [key: string]: IRenderNode } = {};
        children.forEach((child) => {
            childrenMap[child.modelId] = child;
        });
        const newChildren: IDocRenderNodeChild[] = [];
        modelChildren.forEach((modelChild) => {
            newChildren.push(
                this.syncWithModelNode(
                    childrenMap[modelChild.id] || null,
                    modelChild,
                    node,
                ) as any,
            );
        });
        if (
            !testDeepEquality(
                children.map(this.identifyNode),
                newChildren.map(this.identifyNode),
            )
        ) {
            node.setChildren(newChildren);
        }
        return node;
    }

    protected syncWithBlockModelNode(
        node: IBlockRenderNode | null,
        modelNode: IBlockModelNode,
    ) {
        if (!node) {
            node = new BlockRenderNode(modelNode.id);
            node.setStyle({
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
                lineHeight: 1,
            });
        }
        const children = node.children;
        const inlineChildrenMap: { [key: string]: IInlineRenderNode } = {};
        const textChildren: ITextRenderNode[] = [];
        children.forEach((child) => {
            if (child.type === 'inline') {
                inlineChildrenMap[child.modelId] = child;
            } else if (child.type === 'text') {
                textChildren.push(child);
            }
        });
        const newChildren: IBlockRenderNodeChild[] = [];
        let stringStartIndex = 0;
        let content = modelNode.content;
        content = content.slice(0, content.length - 1);
        const markStartMap: { [key: number]: IMark[] } = {};
        const markEndMap: { [key: number]: IMark[] } = {};
        modelNode.marks.forEach((mark) => {
            markStartMap[mark.start] = markStartMap[mark.start] || [];
            markStartMap[mark.start].push(mark);
            markEndMap[mark.end] = markEndMap[mark.end] || [];
            markEndMap[mark.end].push(mark);
        });
        let currentMarks: IMark[] = [];
        content.forEach((c, index) => {
            let marksChanged = !!(markStartMap[index] || markEndMap[index]);
            if (
                index > stringStartIndex &&
                (typeof c !== 'string' || marksChanged)
            ) {
                newChildren.push(
                    this.syncTextNode(
                        textChildren.shift() || null,
                        (content.slice(
                            stringStartIndex,
                            index,
                        ) as string[]).join(''),
                        currentMarks,
                    ),
                );
                stringStartIndex = index;
            }
            if (markStartMap[index]) {
                const marks = markStartMap[index];
                currentMarks.push(...marks);
            }
            if (markEndMap[index]) {
                const marks = markEndMap[index];
                currentMarks = currentMarks.filter((m) => !marks.includes(m));
            }
            if (typeof c !== 'string') {
                this.syncWithModelNode(
                    inlineChildrenMap[c.id] || null,
                    c,
                    node,
                );
            }
        });
        if (stringStartIndex < content.length) {
            newChildren.push(
                this.syncTextNode(
                    textChildren.shift() || null,
                    (content.slice(stringStartIndex) as string[]).join(''),
                    currentMarks,
                ),
            );
        }
        if (
            !testDeepEquality(
                children.map(this.identifyNode),
                newChildren.map(this.identifyNode),
            )
        ) {
            node.setChildren(newChildren);
        }
        return node;
    }

    protected syncWithInlineModelNode(
        node: IInlineRenderNode | null,
        modelNode: IInlineModelNode,
    ) {
        if (!node) {
            node = new InlineRenderNode(modelNode.id);
            node.setStyle({
                width: 0,
                height: 0,
            });
        }
        return node;
    }

    protected syncTextNode(
        node: ITextRenderNode | null,
        content: string,
        marks: IMark[],
    ) {
        if (!node) {
            node = new TextRenderNode();
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
        }
        if (node.content !== content) {
            node.setContent(content);
        }
        const style = node.style;
        const newStyle = marks.reduce(
            (newStyle, mark) =>
                Object.assign(
                    newStyle,
                    this.markService
                        .getMarkType(mark.typeId)
                        .getStyle(mark.attributes),
                ),
            { ...style },
        );
        if (!testDeepEquality(style, newStyle)) {
            node.setStyle(newStyle);
        }
        return node;
    }

    protected syncStyleWithModelNode(node: IRenderNode, modelNode: IModelNode) {
        const style = node.style;
        const component = this.componentService.getComponent(
            modelNode.componentId,
        );
        if (!component) {
            throw new Error(
                `Unregistered component ID: ${modelNode.componentId}.`,
            );
        }
        const { style: newStyle } = component.render(modelNode.attributes);
        if (!testDeepEquality(style, newStyle)) {
            node.setStyle(newStyle as any);
        }
    }

    protected identifyNode(node: IRenderNode) {
        return node.id;
    }
}
