import Editor from '../Editor';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import { DOMAttributes, ResolvedPosition } from '../model/Element';
import BlockElement from '../model/BlockElement';
import Paragraph from '../model/Paragraph';
import Text from '../model/Text';
import { insert } from '../command/commands';
import Attributes from '../token/Attributes';
import generateID from '../utils/generateID';

const DOM_NODE_NAMES_TO_IGNORE = [
  'META',
];

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
  if (DOM_NODE_NAMES_TO_IGNORE.includes(node.nodeName)) {
    return [];
  }
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

function interpretRootDOMNode(editor: Editor, node: Node, defaultBlockElement: BlockElement) {
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

function compareAttributes(attributes1: Attributes, attributes2: Attributes) {
  const { id: id1, ...attr1 } = attributes1;
  const { id: id2, ...attr2 } = attributes2;
  return JSON.stringify(attr1) === JSON.stringify(attr2);
}

function replaceNewLineTokens(editor: Editor, tokens: Token[]) {
  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n];
    if (token === '\n') {
      tokens = [
        ...tokens.slice(0, n),
        new CloseTagToken(),
        new CloseTagToken(),
        new OpenTagToken('Paragraph', generateID(), {}),
        new OpenTagToken('Text', generateID(), {}),
        ...tokens.slice(n + 1),
      ];
    }
  }
  return tokens;
}

function wrapTokens(tokens: Token[], cursorPosition: ResolvedPosition) {
  let currentCursorPosition = cursorPosition.child;
  let currentTokenOffset = 0;
  while (currentCursorPosition) {
    const element = currentCursorPosition.element;
    const token = tokens[currentTokenOffset];
    if (!(token instanceof OpenTagToken)) {
      break;
    }
    let isSame: boolean = true;
    if (element.getType() !== token.getType()) {
      isSame = false;
    }
    if (!compareAttributes(element.getAttributes(), token.getAttributes())) {
      isSame = false;
    }
    if (isSame) {
      tokens = tokens.slice(1, tokens.length - 1);
    } else {
      tokens = [
        new CloseTagToken(),
        ...tokens,
        new OpenTagToken(
          element.getType(),
          element.getID(),
          element.getAttributes(),
        ),
      ];
      currentTokenOffset += 2;
    }
    currentCursorPosition = currentCursorPosition.child;
  }
  return tokens;
}

function paste(editor: Editor, data: DataTransfer) {
  const iframeDoc = $iframe.contentDocument;
  if (!iframeDoc) {
    return;
  }
  const content = data.getData('text/html') || data.getData('text/plain');
  iframeDoc.body.innerHTML = content;
  const bodyNode = iframeDoc.body;
  const cursorSelectableOffset = Math.min(editor.getCursor().getHead(), editor.getCursor().getAnchor());
  const cursorOffset = editor.getRenderManager().getModelOffset(cursorSelectableOffset);
  const cursorPosition = editor.getModelManager().resolveOffset(cursorOffset);
  let defaultBlockElement: BlockElement;
  if (cursorPosition.child && cursorPosition.child.element instanceof BlockElement) {
    defaultBlockElement = cursorPosition.child.element;
  } else {
    defaultBlockElement = new Paragraph(editor);
  }
  const blockElements = interpretRootDOMNode(editor, bodyNode, defaultBlockElement);
  let tokens: Token[] = [];
  blockElements.forEach(element => {
    tokens.push(...element.toTokens());
  });
  tokens = replaceNewLineTokens(editor, tokens);
  tokens = wrapTokens(tokens, cursorPosition);
  editor.getDispatcher().dispatchCommand(insert(tokens));
}

export default paste;
