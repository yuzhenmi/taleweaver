import { ComponentService } from '../component/service';
import { Mark } from '../mark/mark';
import { MarkService } from '../mark/service';
import { DocModelNode } from '../model/nodes/doc';
import { BlockModelNode } from '../model/nodes/block';
import { InlineModelNode } from '../model/nodes/inline';
import { ModelNode } from '../model/nodes';
import { testArrayEquality, testObjectEquality } from '../util/compare';
import { DocRenderChildNode, DocRenderNode } from './nodes/doc';
import { BlockRenderNode, BlockRenderChildNode } from './nodes/block';
import { InlineRenderNode } from './nodes/inline';
import { RenderNode } from './nodes';
import { TextRenderNode } from './nodes/text';

export class RenderTreeManager {
    constructor(protected componentService: ComponentService, protected markService: MarkService) {}

    updateFromModel(doc: DocRenderNode | null, modelDoc: DocModelNode<any>) {
        return this.updateNodeFromModel(doc, modelDoc);
    }

    protected updateNodeFromModel(node: DocRenderNode | null, modelNode: DocModelNode<any>): DocRenderNode;
    protected updateNodeFromModel(node: BlockRenderNode | null, modelNode: BlockModelNode<any>): BlockRenderNode;
    protected updateNodeFromModel(node: InlineRenderNode | null, modelNode: InlineModelNode<any>): InlineRenderNode;
    protected updateNodeFromModel(node: RenderNode | null, modelNode: ModelNode) {
        if (!modelNode.needRender && node) {
            return node;
        }
        let updatedNode: RenderNode;
        if (modelNode.type === 'doc' && (!node || node.type === 'doc')) {
            updatedNode = this.updateDocFromModel(node, modelNode);
        } else if (modelNode.type === 'block' && (!node || node.type === 'block')) {
            updatedNode = this.updateBlockFromModel(node, modelNode);
        } else if (modelNode.type === 'inline' && (!node || node.type === 'inline')) {
            updatedNode = this.updateInlineFromModel(node, modelNode);
        } else {
            throw new Error('Invalid render and model node pair for syncing.');
        }
        this.updateStyleFromModel(updatedNode, modelNode);
        modelNode.markAsRendered();
        return updatedNode;
    }

    protected updateDocFromModel(node: DocRenderNode | null, modelNode: DocModelNode<any>) {
        if (!node) {
            node = new DocRenderNode(modelNode.id);
        }
        const children = node.children;
        const modelChildren = modelNode.children;
        const childrenMap: { [key: string]: DocRenderChildNode } = {};
        children.forEach((child) => {
            childrenMap[child.modelId] = child;
        });
        const newChildren: DocRenderChildNode[] = [];
        modelChildren.forEach((modelChild) => {
            const child = childrenMap[modelChild.id] || null;
            newChildren.push(this.updateNodeFromModel(child, modelChild));
        });
        if (!testArrayEquality(children, newChildren)) {
            node.setChildren(newChildren);
        }
        return node;
    }

    protected updateBlockFromModel(node: BlockRenderNode | null, modelNode: BlockModelNode<any>) {
        if (!node) {
            node = new BlockRenderNode(modelNode.id);
        }
        const children = node.children;
        const inlineChildrenMap: { [key: string]: InlineRenderNode } = {};
        const textChildren: TextRenderNode[] = [];
        children.forEach((child) => {
            if (child.type === 'inline') {
                inlineChildrenMap[child.modelId] = child;
            } else if (child.type === 'text') {
                textChildren.push(child);
            }
        });
        const newChildren: BlockRenderChildNode[] = [];
        let stringStartIndex = 0;
        const modelChildren = modelNode.children;
        const markStartMap: { [key: number]: Mark[] } = {};
        const markEndMap: { [key: number]: Mark[] } = {};
        modelNode.marks.forEach((mark) => {
            markStartMap[mark.start] = markStartMap[mark.start] || [];
            markStartMap[mark.start].push(mark);
            markEndMap[mark.end] = markEndMap[mark.end] || [];
            markEndMap[mark.end].push(mark);
        });
        let currentMarks: Mark[] = [];
        modelChildren.forEach((modelChild, index) => {
            let marksChanged = !!(markStartMap[index] || markEndMap[index]);
            if (index > stringStartIndex && (typeof modelChild !== 'string' || marksChanged)) {
                newChildren.push(
                    this.updateText(
                        textChildren.shift() || null,
                        (modelChildren.slice(stringStartIndex, index) as string[]).join(''),
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
                currentMarks = currentMarks.filter((mark) => !marks.includes(mark));
            }
            if (typeof modelChild !== 'string') {
                newChildren.push(this.updateNodeFromModel(inlineChildrenMap[modelChild.id] || null, modelChild));
            }
        });
        if (stringStartIndex < modelChildren.length) {
            newChildren.push(
                this.updateText(
                    textChildren.shift() || null,
                    (modelChildren.slice(stringStartIndex) as string[]).join(''),
                    currentMarks,
                ),
            );
        }
        if (!testArrayEquality(children, newChildren)) {
            node.setChildren(newChildren);
        }
        return node;
    }

    protected updateInlineFromModel(node: InlineRenderNode | null, modelNode: InlineModelNode<any>) {
        if (!node) {
            node = new InlineRenderNode(modelNode.id);
        }
        return node;
    }

    protected updateText(node: TextRenderNode | null, content: string, marks: Mark[]) {
        if (!node) {
            node = new TextRenderNode();
        }
        if (node.content !== content) {
            node.setContent(content);
        }
        const style = node.style;
        const newStyle = marks.reduce(
            (newStyle, mark) =>
                Object.assign(newStyle, this.markService.getMarkType(mark.typeId).getStyle(mark.attributes)),
            { ...style },
        );
        if (!testObjectEquality(style, newStyle)) {
            node.setStyle(newStyle);
        }
        return node;
    }

    protected updateStyleFromModel(node: RenderNode, modelNode: ModelNode) {
        const style = node.style;
        const component = this.componentService.getComponent(modelNode.componentId);
        if (!component) {
            throw new Error(`Unregistered component ID: ${modelNode.componentId}.`);
        }
        const { style: newStyle } = component.render(modelNode.attributes);
        if (!testObjectEquality(style, newStyle)) {
            node.setStyle(newStyle as any);
        }
    }
}
