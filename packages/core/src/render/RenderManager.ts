import Editor from '../Editor';
import { TextStyle } from '../model/Text';
<<<<<<< Updated upstream
=======
import { ResolvedPosition } from './RenderNode';
>>>>>>> Stashed changes
import DocRenderNode from './DocRenderNode';
import RenderEngine from './RenderEngine';
import RenderNode, { ResolvedPosition } from './RenderNode';
import InlineRenderNode from './InlineRenderNode';
import TextInlineRenderNode from './TextInlineRenderNode';
import LineBreakInlineRenderNode from './LineBreakInlineRenderNode';

<<<<<<< Updated upstream
function getLeafPosition(position: ResolvedPosition): ResolvedPosition {
  if (!position.child) {
    return position
  }
  return getLeafPosition(position.child);
=======
function getInlinePosition(position: ResolvedPosition): ResolvedPosition {
  if (position.renderNode instanceof InlineRenderNode) {
    return position;
  }
  const child = position.child;
  if (!child) {
    throw new Error(`Failed to get position at ${position.offset} of render node ${position.renderNode.getID()}.`);
  }
  return getInlinePosition(child);
>>>>>>> Stashed changes
}

class RenderManager {
  protected editor: Editor;
  protected docNode: DocRenderNode;
  protected renderEngine: RenderEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    const modelManager = editor.getModelManager();
    const doc = modelManager.getDoc();
    this.docNode = new DocRenderNode(editor, doc.getID());
    this.renderEngine = new RenderEngine(editor, this.docNode);
  }

  getDocRenderNode() {
    return this.docNode;
  }

<<<<<<< Updated upstream
  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    return this.docRenderNode.convertSelectableOffsetToModelOffset(selectableOffset);
  }

  resolveSelectableOffset(selectableOffset: number) {
    return this.docRenderNode.resolveSelectableOffset(selectableOffset);
  }

  getTextStyleBetween(from: number, to: number) {
    const _from = from;
    const _to = to;
    from = Math.min(_from, _to);
    to = Math.max(_from, _to);
    if (from < to) {
      to--;
    } else if (from > to) {
      from--;
    }
    const renderManager =  this.editor.getRenderManager();
    let fromInlineRenderNode: InlineRenderNode | null = null;
    while (fromInlineRenderNode === null) {
      const fromPosition = renderManager.resolveSelectableOffset(from);
      const fromInlinePosition = getLeafPosition(fromPosition).parent!;
      if (!(fromInlinePosition.renderNode instanceof InlineRenderNode)) {
        return null;
      }
      fromInlineRenderNode = fromInlinePosition.renderNode;
      if (fromInlineRenderNode instanceof LineBreakInlineRenderNode) {
        fromInlineRenderNode = null;
        if (from === to) {
          if (from === 0) {
            return null;
          }
          from--;
          to--;
        } else {
          from++;
        }
      }
    }
    let toInlineRenderNode: InlineRenderNode | null = null;
    while (toInlineRenderNode === null) {
      const toPosition = renderManager.resolveSelectableOffset(to);
      const toInlinePosition = getLeafPosition(toPosition).parent!;
      if (!(toInlinePosition.renderNode instanceof InlineRenderNode)) {
        return null;
=======
  getModelOffset(offset: number): number {
    return this.docNode.getModelOffset(offset);
  }

  resolveOffset(offset: number) {
    return this.docNode.resolveOffset(offset);
  }

  getInlineNodesBetween(from: number, to: number) {
    const nodes: InlineRenderNode[] = [];
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    const renderManager = this.editor.getRenderManager();
    const fromPosition = renderManager.resolveOffset(min);
    const toPosition = renderManager.resolveOffset(max);
    let fromNode = getInlinePosition(fromPosition).renderNode as InlineRenderNode;
    let toNode = getInlinePosition(toPosition).renderNode as InlineRenderNode;
    try {
      fromNode.getPreviousSibling();
    } catch (error) {
      const siblings = fromNode.getParent().getChildren();
      fromNode = siblings[siblings.length - 1];
    }
    try {
      toNode.getPreviousSibling();
    } catch (error) {
      const siblings = toNode.getParent().getChildren();
      toNode = siblings[siblings.length - 1];
    }
    let node = fromNode;
    while (true) {
      nodes.push(node);
      if (toNode instanceof LineBreakInlineRenderNode) {
        const siblings = toNode.getParent().getChildren();
        if (node === siblings[siblings.length - 1]) {
          break;
        }
      } else {
        if (node === toNode) {
          break;
        }
      }
      const nextNode = node.getNextSibling();
      if (!nextNode) {
        break;
      }
      node = nextNode;
    }
    return nodes;
  }

  getTextStyleBetween(from: number, to: number) {
    const nodes = this.getInlineNodesBetween(from, to);
    const textStyles: TextStyle[] = [];
    nodes.forEach(node => {
      let textStyle: TextStyle | null = null;
      if (node instanceof TextInlineRenderNode) {
        textStyle = node.getTextStyle();
>>>>>>> Stashed changes
      }
      toInlineRenderNode = toInlinePosition.renderNode;
      if (toInlineRenderNode instanceof LineBreakInlineRenderNode) {
        toInlineRenderNode = null;
        if (from === to) {
          return null;
        }
        to--;
      }
    }
    if (fromInlineRenderNode === toInlineRenderNode) {
      return this.getInlineRenderNodeTextStyle(fromInlineRenderNode);
    }
    const textStyles: Array<TextStyle | null> = [];
    let inlineRenderNode: InlineRenderNode = fromInlineRenderNode;
    let isLastIteration = false;
    while (true) {
      const textStyle = this.getInlineRenderNodeTextStyle(inlineRenderNode);
      textStyles.push(textStyle);
      const nextSibling = inlineRenderNode.getNextSibling();
      if (!nextSibling) {
        break;
      }
      inlineRenderNode = nextSibling;
      if (isLastIteration) {
        break;
      }
      if (inlineRenderNode === toInlineRenderNode) {
        isLastIteration = true;
      }
    }
    const textStylesWithoutNull: TextStyle[] = [];
    textStyles.forEach(textStyle => textStyle && textStylesWithoutNull.push(textStyle));
    if (textStylesWithoutNull.length === 0) {
      return null;
    }
    const mergedTextStyle = textStylesWithoutNull.reduce(
      (mergedTextStyle, textStyle) => this.mergeTextStyles(
        mergedTextStyle,
        textStyle,
      ),
      textStylesWithoutNull[0],
    );
    return mergedTextStyle;
  }

  protected mergeTextStyles(textStyle1: TextStyle, textStyle2: TextStyle): TextStyle {
    return {
      weight: this.mergeTextStyleAttributes(textStyle1.weight, textStyle2.weight, null),
      size: this.mergeTextStyleAttributes(textStyle1.size, textStyle2.size, null),
      color: this.mergeTextStyleAttributes(textStyle1.color, textStyle2.color, null),
      font: this.mergeTextStyleAttributes(textStyle1.font, textStyle2.font, null),
      letterSpacing: this.mergeTextStyleAttributes(textStyle1.letterSpacing, textStyle2.letterSpacing, null),
      italic: this.mergeTextStyleAttributes(textStyle1.italic, textStyle2.italic, false),
      underline: this.mergeTextStyleAttributes(textStyle1.underline, textStyle2.underline, false),
      strikethrough: this.mergeTextStyleAttributes(textStyle1.strikethrough, textStyle2.strikethrough, false),
    };
  }

  protected mergeTextStyleAttributes<T>(attribute1: T, attribute2: T, defaultValue: T) {
    if (attribute1 === attribute2) {
      return attribute1;
    }
    return defaultValue;
  }
}

export default RenderManager;
