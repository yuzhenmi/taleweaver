import { insert } from '../command/commands';
import Editor from '../Editor';
import BlockNode from '../model/BlockModelNode';
import { DOMAttributes } from '../model/ModelNode';
import Position from '../model/ModelPosition';
import Paragraph from '../model/ParagraphModelNode';
import Text from '../model/TextModelNode';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken, { Attributes } from '../state/OpenTagToken';
import Token from '../state/Token';
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

type AnyBlockNode = BlockNode<any>;

interface InterpretedDOMNode {
    blockNode: AnyBlockNode | null;
    content: string;
}

function getBlockNodeFromDOMNode(editor: Editor, node: Node, attributes: DOMAttributes) {
    const nodeConfig = editor.getConfig().getNodeConfig();
    const nodeName = node.nodeName;
    const nodeClasses = nodeConfig.getAllModelNodeClasses();
    let blockNode: AnyBlockNode | null = null;
    for (let n = 0, nn = nodeClasses.length; n < nn; n++) {
        const NodeClass = nodeClasses[n];
        if (!(NodeClass.prototype instanceof BlockNode)) {
            continue;
        }
        const nodeNames = (NodeClass as any).getDOMNodeNames() as string[];
        if (nodeNames.includes(nodeName)) {
            blockNode = (NodeClass as any).fromDOM(editor, nodeName, attributes);
        }
    }
    return blockNode;
}

function interpretDOMNode(editor: Editor, node: Node, attributes: DOMAttributes, parentBlockNode: AnyBlockNode): InterpretedDOMNode[] {
    if (DOM_NODE_NAMES_TO_IGNORE.includes(node.nodeName)) {
        return [];
    }
    const blockNode = getBlockNodeFromDOMNode(editor, node, attributes);
    const unmergedInterpretedNodes: InterpretedDOMNode[][] = [];
    let hasBlockNode: boolean = false;
    node.childNodes.forEach(childNode => {
        const interpretedNodes = interpretDOMNode(editor, childNode, attributes, blockNode || parentBlockNode);
        unmergedInterpretedNodes.push(interpretedNodes);
        if (interpretedNodes.some(n => !!n.blockNode)) {
            hasBlockNode = true;
        }
    });
    const mergedInterpretedNodes: InterpretedDOMNode[] = [];
    if (hasBlockNode) {
        unmergedInterpretedNodes.forEach(interpretedNodes => {
            interpretedNodes.forEach(interpretedNode => {
                if (!interpretedNode.blockNode) {
                    interpretedNode.blockNode = (blockNode || parentBlockNode).clone();
                }
                mergedInterpretedNodes.push(interpretedNode);
            });
        });
    } else {
        mergedInterpretedNodes.push({
            blockNode,
            content: node.textContent || '',
        });
    }
    return mergedInterpretedNodes;
}

function interpretRootDOMNode(editor: Editor, node: Node, defaultBlockNode: AnyBlockNode) {
    const interpretedNodes = interpretDOMNode(editor, node, {}, defaultBlockNode);
    const blockNodes = interpretedNodes.map(interpretedNode => {
        if (!interpretedNode.blockNode) {
            interpretedNode.blockNode = defaultBlockNode.clone();
        }
        const { blockNode, content } = interpretedNode;
        const inlineNode = new Text(editor, generateID(), {});
        inlineNode.setContent(content);
        blockNode!.appendChild(inlineNode);
        return blockNode!;
    });
    return blockNodes;
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

function wrapTokens(tokens: Token[], cursorPosition: Position) {
    let currentCursorPosition = cursorPosition.getChild();
    let currentTokenOffset = 0;
    while (currentCursorPosition) {
        const node = currentCursorPosition.getNode();
        const token = tokens[currentTokenOffset];
        if (!(token instanceof OpenTagToken)) {
            break;
        }
        let isSame: boolean = true;
        if (node.getType() !== token.getType()) {
            isSame = false;
        }
        if (!compareAttributes(node.getAttributes(), token.getAttributes())) {
            isSame = false;
        }
        if (isSame) {
            tokens = tokens.slice(1, tokens.length - 1);
        } else {
            tokens = [
                new CloseTagToken(),
                ...tokens,
                new OpenTagToken(
                    node.getType(),
                    node.getID(),
                    node.getAttributes(),
                ),
            ];
            currentTokenOffset += 2;
        }
        currentCursorPosition = currentCursorPosition.getChild();
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
    const cursorService = editor.getCursorService();
    const modelService = editor.getModelService();
    const renderService = editor.getRenderService();
    const cursorRenderOffset = Math.min(cursorService.getHead(), cursorService.getAnchor());
    const cursorOffset = renderService.convertOffsetToModelOffset(cursorRenderOffset);
    const cursorPosition = modelService.resolvePosition(cursorOffset);
    let defaultBlockNode: AnyBlockNode | null = null;
    const blockPosition = cursorPosition.getChild();
    if (blockPosition) {
        const node = blockPosition.getNode();
        if (node instanceof BlockNode) {
            defaultBlockNode = node;
        }
    }
    if (!defaultBlockNode) {
        defaultBlockNode = new Paragraph(editor, generateID(), {});
    }
    const blockNodes = interpretRootDOMNode(editor, bodyNode, defaultBlockNode);
    let tokens: Token[] = [];
    blockNodes.forEach(blockNode => {
        tokens.push(...blockNode.toTokens());
    });
    tokens = replaceNewLineTokens(editor, tokens);
    tokens = wrapTokens(tokens, cursorPosition);
    editor.getDispatcher().dispatchCommand(insert(tokens));
}

export default paste;
