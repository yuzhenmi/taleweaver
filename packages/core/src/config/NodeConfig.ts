import Editor from '../Editor';
import AtomicBox from '../layout/AtomicLayoutNode';
import BlockBox from '../layout/BlockLayoutNode';
import InlineBox from '../layout/InlineLayoutNode';
import LineBreakAtomicBox from '../layout/LineBreakAtomicLayoutNode';
import LineBreakInlineBox from '../layout/LineBreakLayoutNode';
import ParagraphBlockBox from '../layout/ParagraphLayoutNode';
import TextInlineBox from '../layout/TextLayoutNode';
import TextAtomicBox from '../layout/TextWordLayoutNode';
import { AnyModelNode } from '../model/ModelNode';
import ParagraphModelNode from '../model/ParagraphModelNode';
import TextModelNode from '../model/TextModelNode';
import ParagraphRenderNode from '../render/ParagraphRenderNode';
import { AnyRenderNode } from '../render/RenderNode';
import TextRenderNode from '../render/TextRenderNode';
import { Attributes } from '../state/OpenTagToken';
import BlockViewNode from '../view/BlockViewNode';
import InlineViewNode from '../view/InlineViewNode';
import LineBreakInlineViewNode from '../view/LineBreakInlineViewNode';
import ParagraphBlockViewNode from '../view/ParagraphBlockViewNode';
import TextInlineViewNode from '../view/TextInlineViewNode';

type ModelNodeClass = new (editor: Editor, attributes: Attributes) => AnyModelNode;
type RenderNodeClass = new (editor: Editor, modelNode: AnyModelNode) => AnyRenderNode;
type BlockBoxClass = new (editor: Editor, renderNodeId: string) => BlockBox;
type InlineBoxClass = new (editor: Editor, renderNodeId: string) => InlineBox;
type AtomicBoxClass = new (editor: Editor, renderNodeId: string) => AtomicBox;
type BlockViewNodeClass = new (edito: Editor, id: string) => BlockViewNode;
type InlineViewNodeClass = new (edito: Editor, id: string) => InlineViewNode;

export default class NodeConfig {
  protected modelNodeClasses: Map<string, ModelNodeClass> = new Map();
  protected orderedModelNodeClasses: ModelNodeClass[] = [];
  protected renderNodeClasses: Map<string, RenderNodeClass> = new Map();
  protected blockBoxClasses: Map<string, BlockBoxClass> = new Map();
  protected inlineBoxClasses: Map<string, InlineBoxClass> = new Map();
  protected atomicBoxClasses: Map<string, AtomicBoxClass> = new Map();
  protected blockViewNodeClasses: Map<string, BlockViewNodeClass> = new Map();
  protected inlineViewNodeClasses: Map<string, InlineViewNodeClass> = new Map();

  constructor() {
    this.registerModelNodeClass('Paragraph', ParagraphModelNode);
    this.registerModelNodeClass('Text', TextModelNode);
    this.registerRenderNodeClass('Paragraph', ParagraphRenderNode);
    this.registerRenderNodeClass('Text', TextRenderNode);
    this.registerBlockBoxClass('ParagraphRenderNode', ParagraphBlockBox);
    this.registerInlineBoxClass('TextRenderNode', TextInlineBox);
    this.registerInlineBoxClass('LineBreakInlineRenderNode', LineBreakInlineBox);
    this.registerAtomicBoxClass('TextAtomicRenderNode', TextAtomicBox);
    this.registerAtomicBoxClass('LineBreakAtomicRenderNode', LineBreakAtomicBox);
    this.registerBlockViewNodeClass('ParagraphBlockBox', ParagraphBlockViewNode);
    this.registerInlineViewNodeClass('TextInlineBox', TextInlineViewNode);
    this.registerInlineViewNodeClass('LineBreakInlineBox', LineBreakInlineViewNode);
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

  registerRenderNodeClass(modelNodeType: string, renderNodeClass: RenderNodeClass) {
    this.renderNodeClasses.set(modelNodeType, renderNodeClass);
  }

  getRenderNodeClass(modelNodeType: string) {
    if (!this.renderNodeClasses.has(modelNodeType)) {
      throw new Error(`Render node for model node type ${modelNodeType} is not registered.`);
    }
    return this.renderNodeClasses.get(modelNodeType)!;
  }

  registerBlockBoxClass(renderNodeType: string, boxClass: BlockBoxClass) {
    this.blockBoxClasses.set(renderNodeType, boxClass);
  }

  getBlockBoxClass(renderNodeType: string) {
    if (!this.blockBoxClasses.has(renderNodeType)) {
      throw new Error(`Block box for render node type ${renderNodeType} is not registered.`);
    }
    return this.blockBoxClasses.get(renderNodeType)!;
  }

  registerInlineBoxClass(renderNodeType: string, boxClass: InlineBoxClass) {
    this.inlineBoxClasses.set(renderNodeType, boxClass);
  }

  getInlineBoxClass(renderNodeType: string) {
    if (!this.inlineBoxClasses.has(renderNodeType)) {
      throw new Error(`Inline box for render node type ${renderNodeType} is not registered.`);
    }
    return this.inlineBoxClasses.get(renderNodeType)!;
  }

  registerAtomicBoxClass(renderNodeType: string, boxClass: AtomicBoxClass) {
    this.atomicBoxClasses.set(renderNodeType, boxClass);
  }

  getAtomicBoxClass(renderNodeType: string) {
    if (!this.atomicBoxClasses.has(renderNodeType)) {
      throw new Error(`Atomic box for render node type ${renderNodeType} is not registered.`);
    }
    return this.atomicBoxClasses.get(renderNodeType)!;
  }

  registerBlockViewNodeClass(boxType: string, viewNodeClass: BlockViewNodeClass) {
    this.blockViewNodeClasses.set(boxType, viewNodeClass);
  }

  getBlockViewNodeClass(boxType: string) {
    if (!this.blockViewNodeClasses.has(boxType)) {
      throw new Error(`Block view node for box type ${boxType} is not registered.`);
    }
    return this.blockViewNodeClasses.get(boxType)!;
  }

  registerInlineViewNodeClass(boxType: string, viewNodeClass: InlineViewNodeClass) {
    this.inlineViewNodeClasses.set(boxType, viewNodeClass);
  }

  getInlineViewNodeClass(boxType: string) {
    if (!this.inlineViewNodeClasses.has(boxType)) {
      throw new Error(`Inline view node for box type ${boxType} is not registered.`);
    }
    return this.inlineViewNodeClasses.get(boxType)!;
  }
}
