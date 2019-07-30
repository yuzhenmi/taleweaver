import Editor from '../Editor';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import BlockModelNode from './BlockModelNode';
import DocModelNode from './DocModelNode';
import InlineModelNode from './InlineModelNode';
import ModelNode from './ModelNode';

enum ParserState {
    NewNode,
    Content,
}

type AnyModelNode = ModelNode<any, any, any>;

class Stack {
    protected nodes: AnyModelNode[];

    constructor() {
        this.nodes = [];
    }

    push(node: AnyModelNode) {
        this.nodes.push(node);
    }

    pop(): AnyModelNode | undefined {
        return this.nodes.pop();
    }

    peek(): AnyModelNode | undefined {
        return this.nodes[this.nodes.length - 1];
    }

    getRootNode() {
        if (this.nodes.length === 0) {
            throw new Error('');
        }
        return this.nodes[0];
    }
}

export default class StateParser {
    protected editor: Editor;
    protected tokens: Token[];
    protected parserState: ParserState = ParserState.NewNode;
    protected rootNode?: AnyModelNode;
    protected stack: Stack = new Stack();
    protected contentBuffer: string = '';
    protected ran: boolean = false;

    constructor(editor: Editor, tokens: Token[]) {
        this.editor = editor;
        this.tokens = tokens;
    }

    run() {
        if (!this.ran) {
            this.parse();
        }
        return this.rootNode!;
    }

    protected parse() {
        this.stack = new Stack();
        let token: Token;
        for (let n = 0, nn = this.tokens.length; n < nn; n++) {
            token = this.tokens[n];
            switch (this.parserState) {
                case ParserState.NewNode:
                    if (token instanceof OpenTagToken) {
                        this.newNode(token);
                        break;
                    }
                    if (typeof token === 'string') {
                        this.appendToContent(token);
                        break;
                    }
                    if (token instanceof CloseTagToken) {
                        this.closeNode(token);
                        break;
                    }
                    this.appendToContent(token);
                    break;
                case ParserState.Content:
                    if (typeof token === 'string') {
                        this.appendToContent(token);
                        break;
                    }
                    if (token instanceof CloseTagToken) {
                        this.closeNode(token);
                        break;
                    }
                default:
                    throw new Error(`Unexpected token at offset ${n}.`);
            }
        }
        this.rootNode = this.stack.getRootNode();
        this.ran = true;
    }

    protected newNode(token: OpenTagToken) {
        const parentNode = this.stack.peek();
        const nodeConfig = this.editor.getConfig().getNodeConfig();
        const NodeClass = nodeConfig.getModelNodeClass(token.getType());
        const node = new NodeClass(this.editor, token.getAttributes());
        if (parentNode instanceof DocModelNode) {
            if (!(node instanceof BlockModelNode)) {
                throw new Error('Unexpected child node for doc.');
            }
            parentNode.appendChild(node);
        } else if (parentNode instanceof BlockModelNode) {
            if (!(node instanceof InlineModelNode)) {
                throw new Error('Unexpected child node for block node.');
            }
            parentNode.appendChild(node);
        }
        this.stack.push(node);
    }

    protected appendToContent(token: string) {
        this.contentBuffer += token;
        this.parserState = ParserState.Content;
    }

    protected closeNode(token: CloseTagToken) {
        const node = this.stack.pop();
        if (node === undefined) {
            throw new Error('Unexpected end of tokens encountered.');
        }
        if (node instanceof InlineModelNode) {
            node.setContent(this.contentBuffer);
        }
        this.contentBuffer = '';
        this.parserState = ParserState.NewNode;
    }
}
