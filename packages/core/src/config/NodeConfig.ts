import Editor from '../Editor';
import AtomicBox from '../layout/AtomicBox';
import BlockBox from '../layout/BlockBox';
import InlineBox from '../layout/InlineBox';
import LineBreakAtomicBox from '../layout/LineBreakAtomicBox';
import LineBreakInlineBox from '../layout/LineBreakInlineBox';
import ParagraphBlockBox from '../layout/ParagraphBlockBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import TextInlineBox from '../layout/TextInlineBox';
import BlockModelNode from '../model/BlockModelNode';
import InlineModelNode from '../model/InlineModelNode';
import ParagraphModelNode from '../model/ParagraphModelNode';
import TextModelNode from '../model/TextModelNode';
import BlockRenderNode from '../render/BlockRenderNode';
import InlineRenderNode from '../render/InlineRenderNode';
import ParagraphBlockRenderNode from '../render/ParagraphBlockRenderNode';
import TextInlineRenderNode from '../render/TextInlineRenderNode';
import { Attributes } from '../state/OpenTagToken';
import BlockViewNode from '../view/BlockViewNode';
import InlineViewNode from '../view/InlineViewNode';
import LineBreakInlineViewNode from '../view/LineBreakInlineViewNode';
import ParagraphBlockViewNode from '../view/ParagraphBlockViewNode';
import TextInlineViewNode from '../view/TextInlineViewNode';

type BlockModelNodeClass = new (editor: Editor, attributes: Attributes) => BlockModelNode<any>;
type InlineModelNodeClass = new (editor: Editor, attributes: Attributes) => InlineModelNode<any>;
type BlockRenderNodeClass = new (editor: Editor, id: string) => BlockRenderNode;
type InlineRenderNodeClass = new (editor: Editor, id: string) => InlineRenderNode;
type BlockBoxClass = new (editor: Editor, renderNodeId: string) => BlockBox;
type InlineBoxClass = new (editor: Editor, renderNodeId: string) => InlineBox;
type AtomicBoxClass = new (editor: Editor, renderNodeId: string) => AtomicBox;
type BlockViewNodeClass = new (edito: Editor, id: string) => BlockViewNode;
type InlineViewNodeClass = new (edito: Editor, id: string) => InlineViewNode;

export default class NodeConfig {
  protected blockModelNodeClasses: Map<string, BlockModelNodeClass> = new Map();
  protected orderedBlockModelNodeClasses: BlockModelNodeClass[] = [];
  protected inlineModelNodeClasses: Map<string, InlineModelNodeClass> = new Map();
  protected orderedInlineModelNodeClasses: InlineModelNodeClass[] = [];
  protected blockRenderNodeClasses: Map<string, BlockRenderNodeClass> = new Map();
  protected inlineRenderNodeClasses: Map<string, InlineRenderNodeClass> = new Map();
  protected blockBoxClasses: Map<string, BlockBoxClass> = new Map();
  protected inlineBoxClasses: Map<string, InlineBoxClass> = new Map();
  protected atomicBoxClasses: Map<string, AtomicBoxClass> = new Map();
  protected blockViewNodeClasses: Map<string, BlockViewNodeClass> = new Map();
  protected inlineViewNodeClasses: Map<string, InlineViewNodeClass> = new Map();

  constructor() {
    this.registerBlockModelNodeClass('Paragraph', ParagraphModelNode);
    this.registerInlineModelNodeClass('Text', TextModelNode);
    this.registerBlockRenderNodeClass('Paragraph', ParagraphBlockRenderNode);
    this.registerInlineRenderNodeClass('Text', TextInlineRenderNode);
    this.registerBlockBoxClass('ParagraphBlockRenderNode', ParagraphBlockBox);
    this.registerInlineBoxClass('TextInlineRenderNode', TextInlineBox);
    this.registerInlineBoxClass('LineBreakInlineRenderNode', LineBreakInlineBox);
    this.registerAtomicBoxClass('TextAtomicRenderNode', TextAtomicBox);
    this.registerAtomicBoxClass('LineBreakAtomicRenderNode', LineBreakAtomicBox);
    this.registerBlockViewNodeClass('ParagraphBlockBox', ParagraphBlockViewNode);
    this.registerInlineViewNodeClass('TextInlineBox', TextInlineViewNode);
    this.registerInlineViewNodeClass('LineBreakInlineBox', LineBreakInlineViewNode);
  }

  registerBlockModelNodeClass(modelNodeType: string, blockModelNodeClass: BlockModelNodeClass) {
    this.blockModelNodeClasses.set(modelNodeType, blockModelNodeClass);
    this.orderedBlockModelNodeClasses.push(blockModelNodeClass);
  }

  getBlockModelNodeClass(modelNodeType: string) {
    if (!this.blockModelNodeClasses.has(modelNodeType)) {
      throw new Error(`Block node type ${modelNodeType} is not registered.`);
    }
    return this.blockModelNodeClasses.get(modelNodeType)!;
  }

  getAllBlockModelNodeClasses() {
    return this.orderedBlockModelNodeClasses;
  }

  registerInlineModelNodeClass(modelNodeType: string, modelNodeClass: InlineModelNodeClass) {
    this.inlineModelNodeClasses.set(modelNodeType, modelNodeClass);
    this.orderedInlineModelNodeClasses.push(modelNodeClass);
  }

  getInlineModelNodeClass(modelNodeType: string) {
    if (!this.inlineModelNodeClasses.has(modelNodeType)) {
      throw new Error(`Inline model node type ${modelNodeType} is not registered.`);
    }
    return this.inlineModelNodeClasses.get(modelNodeType)!;
  }

  getAllInlineModelNodeClasses() {
    return this.orderedInlineModelNodeClasses;
  }

  getModelNodeClass(modelNodeType: string) {
    if (this.blockModelNodeClasses.has(modelNodeType)) {
      return this.blockModelNodeClasses.get(modelNodeType)!;
    }
    if (this.inlineModelNodeClasses.has(modelNodeType)) {
      return this.inlineModelNodeClasses.get(modelNodeType)!;
    }
    throw new Error(`Model node type ${modelNodeType} is not registered.`);
  }

  registerBlockRenderNodeClass(modelNodeType: string, renderNodeClass: BlockRenderNodeClass) {
    this.blockRenderNodeClasses.set(modelNodeType, renderNodeClass);
  }

  getBlockRenderNodeClass(modelNodeType: string) {
    if (!this.blockRenderNodeClasses.has(modelNodeType)) {
      throw new Error(`Block render node for modelNode type ${modelNodeType} is not registered.`);
    }
    return this.blockRenderNodeClasses.get(modelNodeType)!;
  }

  registerInlineRenderNodeClass(modelNodeType: string, renderNodeClass: InlineRenderNodeClass) {
    this.inlineRenderNodeClasses.set(modelNodeType, renderNodeClass);
  }

  getInlineRenderNodeClass(modelNodeType: string) {
    if (!this.inlineRenderNodeClasses.has(modelNodeType)) {
      throw new Error(`Inline render node for modelNode type ${modelNodeType} is not registered.`);
    }
    return this.inlineRenderNodeClasses.get(modelNodeType)!;
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
