import Editor from '../Editor';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import { DOMAttributes, ResolvedPosition } from '../model/Element';
import Doc from '../model/Doc';
import BlockElement from '../model/BlockElement';
import Paragraph from '../model/Paragraph';
import Text from '../model/Text';
import { insert } from '../command/commands';

const $iframe = document.createElement('iframe');
$iframe.scrolling = 'no';
$iframe.src = 'about:blank';
$iframe.style.width = '0';
$iframe.style.height = '0';
$iframe.style.border = 'none';
$iframe.style.position = 'fixed';
$iframe.style.zIndex = '-1';
$iframe.style.opacity = '0';
$iframe.style.overflow = 'hidden';
$iframe.style.left = '-1000000px';
$iframe.style.top = '-1000000px';
$iframe.contentEditable = 'true';
document.body.appendChild($iframe);

interface InterpretedDOMNode {
  blockElement: BlockElement | null;
  content: string;
}

function getBlockElementFromDOMNode(editor: Editor, node: Node, attributes: DOMAttributes) {
  const elementConfig = editor.getConfig().getElementConfig();
  const nodeName = node.nodeName;
  const blockElementClasses = elementConfig.getAllBlockElementClasses();
  let blockElement: BlockElement | null = null;
  for (let n = 0, nn = blockElementClasses.length; n < nn; n++) {
    const blockElementClass = blockElementClasses[n] as any;
    const nodeNames = blockElementClass.getDOMNodeNames();
    if (nodeNames.includes(nodeName)) {
      blockElement = blockElementClass.fromDOM(editor, nodeName, attributes);
    }
  }
  return blockElement;
}

function interpretDOMNode(editor: Editor, node: Node, attributes: DOMAttributes, parentBlockElement: BlockElement): InterpretedDOMNode[] {
  const blockElement = getBlockElementFromDOMNode(editor, node, attributes);
  const unmergedInterpretedNodes: InterpretedDOMNode[][] = [];
  let hasBlockElement: boolean = false;
  node.childNodes.forEach(childNode => {
    const interpretedNodes = interpretDOMNode(editor, childNode, attributes, blockElement || parentBlockElement);
    unmergedInterpretedNodes.push(interpretedNodes);
    if (interpretedNodes.some(n => !!n.blockElement)) {
      hasBlockElement = true;
    }
  });
  const mergedInterpretedNodes: InterpretedDOMNode[] = [];
  if (hasBlockElement) {
    unmergedInterpretedNodes.forEach(interpretedNodes => {
      interpretedNodes.forEach(interpretedNode => {
        if (!interpretedNode.blockElement) {
          interpretedNode.blockElement = (blockElement || parentBlockElement).clone();
        }
        mergedInterpretedNodes.push(interpretedNode);
      });
    });
  } else {
    mergedInterpretedNodes.push({
      blockElement,
      content: node.textContent || '',
    });
  }
  return mergedInterpretedNodes;
}

function interpretRootDOMNode(editor: Editor, node: Node) {
  const defaultBlockElement = new Paragraph(editor);
  const interpretedNodes = interpretDOMNode(editor, node, {}, defaultBlockElement);
  const blockElements = interpretedNodes.map(interpretedNode => {
    if (!interpretedNode.blockElement) {
      interpretedNode.blockElement = defaultBlockElement.clone();
    }
    const { blockElement, content } = interpretedNode;
    const inlineElement = new Text(editor);
    inlineElement.setContent(content);
    blockElement.insertChild(inlineElement);
    return blockElement;
  });
  return blockElements;
}

function getWrappingCloseTagTokens(position: ResolvedPosition) {
  const tokens: CloseTagToken[] = [];
  if (position.child) {
    tokens.push(...getWrappingCloseTagTokens(position.child));
  }
  if (!(position.element instanceof Doc)) {
    tokens.push(new CloseTagToken());
  }
  return tokens;
}

function getWrappingOpenTagTokens(position: ResolvedPosition) {
  const tokens: OpenTagToken[] = [];
  if (!(position.element instanceof Doc)) {
    tokens.push(new OpenTagToken(
      position.element.getType(),
      position.element.getID(),
      position.element.getAttributes(),
    ));
  }
  if (position.child) {
    tokens.push(...getWrappingOpenTagTokens(position.child));
  }
  return tokens;
}

function wrapTokens(editor: Editor, tokens: Token[]) {
  const cursorOffset = Math.min(editor.getCursor().getHead(), editor.getCursor().getAnchor());
  const cursorPosition = editor.getModelManager().resolveOffset(cursorOffset);
  const wrappedTokens = [
    ...getWrappingCloseTagTokens(cursorPosition),
    ...tokens,
    ...getWrappingOpenTagTokens(cursorPosition),
  ];
  return wrappedTokens;
}

function paste(editor: Editor, data: DataTransfer) {
  const iframeDoc = $iframe.contentDocument;
  if (!iframeDoc) {
    return;
  }
  const content = data.getData('text/plain');
  iframeDoc.body.innerHTML = content;
  const bodyNode = iframeDoc.body;
  const blockElements = interpretRootDOMNode(editor, bodyNode);
  const tokens: Token[] = [];
  blockElements.forEach(element => {
    tokens.push(...element.toTokens());
  });
  const wrappedTokens = wrapTokens(editor, tokens);
  editor.getDispatcher().dispatchCommand(insert(wrappedTokens));
}

export default paste;
