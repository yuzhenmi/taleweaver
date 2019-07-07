import Editor from '../../Editor';
import { ResolvedPosition } from '../RenderNode';
import InlineRenderNode from '../InlineRenderNode';
import LineBreakInlineRenderNode from '../LineBreakInlineRenderNode';

function getInlinePosition(position: ResolvedPosition): ResolvedPosition {
  if (position.renderNode instanceof InlineRenderNode) {
    return position;
  }
  const child = position.child;
  if (!child) {
    throw new Error(`Failed to determine inline position at ${position.offset} of render node ${position.renderNode.getID()}.`);
  }
  return getInlinePosition(child);
}

export default function getInlineRenderNodesBetween(editor: Editor, from: number, to: number) {
  const renderNodes: InlineRenderNode[] = [];
  const min = Math.min(from, to);
  const max = Math.max(from, to);
  const renderManager = editor.getRenderManager();
  const fromPosition = renderManager.resolveOffset(min);
  const toPosition = renderManager.resolveOffset(max);
  let fromRenderNode = getInlinePosition(fromPosition).renderNode as InlineRenderNode;
  let toRenderNode = getInlinePosition(toPosition).renderNode as InlineRenderNode;
  try {
    fromRenderNode.getPreviousSibling();
  } catch (error) {
    const siblings = fromRenderNode.getParent().getChildren();
    fromRenderNode = siblings[siblings.length - 1];
  }
  try {
    toRenderNode.getPreviousSibling();
  } catch (error) {
    const siblings = toRenderNode.getParent().getChildren();
    toRenderNode = siblings[siblings.length - 1];
  }
  let renderNode = fromRenderNode;
  while (true) {
    renderNodes.push(renderNode);
    if (toRenderNode instanceof LineBreakInlineRenderNode) {
      const siblings = toRenderNode.getParent().getChildren();
      if (renderNode === siblings[siblings.length - 1]) {
        break;
      }
    } else {
      if (renderNode === toRenderNode) {
        break;
      }
    }
    const nextRenderNode = renderNode.getNextSibling();
    if (!nextRenderNode) {
      break;
    }
    renderNode = nextRenderNode;
  }
  return renderNodes;
}
