import Editor from '../Editor';
import { AnyLayoutNode } from '../layout/LayoutNode';
import LineBreakAtomicLayoutNode from '../layout/LineBreakAtomicLayoutNode';
import LineBreakLayoutNode from '../layout/LineBreakLayoutNode';
import ParagraphLayoutNode from '../layout/ParagraphLayoutNode';
import TextLayoutNode from '../layout/TextLayoutNode';
import TextWordLayoutNode from '../layout/TextWordLayoutNode';
import ModelNode, { AnyModelNode } from '../model/ModelNode';
import ParagraphModelNode from '../model/ParagraphModelNode';
import TextModelNode from '../model/TextModelNode';
import ParagraphRenderNode from '../render/ParagraphRenderNode';
import { AnyRenderNode } from '../render/RenderNode';
import TextRenderNode from '../render/TextRenderNode';
import { Attributes } from '../state/OpenTagToken';
import LineBreakViewNode from '../view/LineBreakViewNode';
import ParagraphViewNode from '../view/ParagraphViewNode';
import TextViewNode from '../view/TextViewNode';
import { AnyViewNode } from '../view/ViewNode';

type ModelNodeClass = new (editor: Editor, attributes: Attributes) => AnyModelNode;
type RenderNodeClass<T extends AnyModelNode> = new (editor: Editor, modelNode: T) => AnyRenderNode;
type LayoutNodeClass<T extends AnyRenderNode> = new (editor: Editor, renderNode: T, ...args: any[]) => AnyLayoutNode;
type ViewNodeClass<T extends AnyLayoutNode> = new (edito: Editor, layoutNode: T) => AnyViewNode;

export default class NodeConfig {
    protected modelNodeClasses: Map<string, ModelNodeClass> = new Map();
    protected orderedModelNodeClasses: ModelNodeClass[] = [];
    protected renderNodeClasses: Map<string, RenderNodeClass<any>> = new Map();
    protected layoutNodeClasses: Map<string, LayoutNodeClass<any>> = new Map();
    protected viewNodeClasses: Map<string, ViewNodeClass<any>> = new Map();

    constructor() {
        this.registerModelNodeClass('Paragraph', ParagraphModelNode);
        this.registerModelNodeClass('Text', TextModelNode);
        this.registerRenderNodeClass('Paragraph', ParagraphRenderNode);
        this.registerRenderNodeClass('Text', TextRenderNode);
        this.registerLayoutNodeClass('Paragraph', ParagraphLayoutNode);
        this.registerLayoutNodeClass('Text', TextLayoutNode);
        this.registerLayoutNodeClass('TextWord', TextWordLayoutNode);
        this.registerLayoutNodeClass('LineBreak', LineBreakLayoutNode);
        this.registerLayoutNodeClass('LineBreakAtomic', LineBreakAtomicLayoutNode);
        this.registerViewNodeClass('Paragraph', ParagraphViewNode);
        this.registerViewNodeClass('Text', TextViewNode);
        this.registerViewNodeClass('LineBreak', LineBreakViewNode);
    }

    registerModelNodeClass(modelNodeType: string, modelNodeClass: ModelNodeClass) {
        this.modelNodeClasses.set(modelNodeType, modelNodeClass);
        this.orderedModelNodeClasses.push(modelNodeClass);
    }

    getModelNodeClass(modelNodeType: string) {
        if (!this.modelNodeClasses.has(modelNodeType)) {
            throw new Error(`Model node type ${modelNodeType} is not registered.`);
        }
        return this.modelNodeClasses.get(modelNodeType)!;
    }

    getAllModelNodeClasses() {
        return this.orderedModelNodeClasses;
    }

    registerRenderNodeClass(modelNodeType: string, renderNodeClass: RenderNodeClass<any>) {
        this.renderNodeClasses.set(modelNodeType, renderNodeClass);
    }

    getRenderNodeClass(modelNodeType: string) {
        if (!this.renderNodeClasses.has(modelNodeType)) {
            throw new Error(`Render node for model node type ${modelNodeType} is not registered.`);
        }
        return this.renderNodeClasses.get(modelNodeType)!;
    }

    registerLayoutNodeClass(renderNodeType: string, layoutNodeClass: LayoutNodeClass<any>) {
        this.layoutNodeClasses.set(renderNodeType, layoutNodeClass);
    }

    getLayoutNodeClass(renderNodeType: string) {
        if (!this.layoutNodeClasses.has(renderNodeType)) {
            throw new Error(`Layout node for render node type ${renderNodeType} is not registered.`);
        }
        return this.layoutNodeClasses.get(renderNodeType)!;
    }

    registerViewNodeClass(layoutNodeType: string, viewNodeClass: ViewNodeClass<any>) {
        this.viewNodeClasses.set(layoutNodeType, viewNodeClass);
    }

    getViewNodeClass(layoutNodeType: string) {
        if (!this.viewNodeClasses.has(layoutNodeType)) {
            throw new Error(`View node for layout node type ${layoutNodeType} is not registered.`);
        }
        return this.viewNodeClasses.get(layoutNodeType)!;
    }
}
