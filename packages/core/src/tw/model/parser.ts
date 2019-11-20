import { IElementService } from 'tw/element/service';
import { InlineModelNode } from 'tw/model/inline-node';
import { IModelNode } from 'tw/model/node';
import { CLOSE_TOKEN, IAttributes, ICloseToken, IContentToken, IOpenToken, IToken } from 'tw/state/token';
import { BlockModelNode } from './block-node';
import { RootModelNode } from './root-node';

enum ParserState {
    NewNode,
    Content,
}

class Stack {
    protected nodes: IModelNode<any>[];

    constructor() {
        this.nodes = [];
    }

    push(node: IModelNode<any>) {
        this.nodes.push(node);
    }

    pop(): IModelNode<any> | undefined {
        return this.nodes.pop();
    }

    peek(): IModelNode<any> | undefined {
        return this.nodes[this.nodes.length - 1];
    }

    getRootNode() {
        if (this.nodes.length === 0) {
            throw new Error('Error parsing state.');
        }
        return this.nodes[0];
    }
}

export default class TokenParser {
    protected tokens?: IToken[];
    protected parserState: ParserState = ParserState.NewNode;
    protected rootNode?: IModelNode<any>;
    protected stack: Stack = new Stack();
    protected contentBuffer: string = '';
    protected ran: boolean = false;

    constructor(protected elementService: IElementService) {}

    parse(tokens: IToken[]) {
        if (this.ran) {
            throw new Error('Parser has already been run.');
        }
        this.tokens = tokens;
        this._parse();
        this.ran = true;
        return this.rootNode!;
    }

    protected _parse() {
        const tokens = this.tokens!;
        this.stack = new Stack();
        let token: IToken;
        for (let n = 0, nn = tokens.length; n < nn; n++) {
            token = tokens[n];
            try {
                switch (this.parserState) {
                    case ParserState.NewNode:
                        if (typeof token === 'string') {
                            this.appendToContent(token);
                            break;
                        }
                        if (token === CLOSE_TOKEN) {
                            this.closeNode(token);
                            break;
                        }
                        if (typeof token === 'object') {
                            this.newNode(token as IOpenToken);
                            break;
                        }
                        throw new Error('Invalid token.');
                    case ParserState.Content:
                        if (typeof token === 'string') {
                            this.appendToContent(token);
                            break;
                        }
                        if (token === CLOSE_TOKEN) {
                            this.closeNode(token);
                            break;
                        }
                    default:
                        throw new Error('Unexpected token encountered.');
                }
            } catch (error) {
                throw new Error(`Error at token ${n}: ${error}`);
            }
        }
        this.ran = true;
    }

    protected newNode(token: IOpenToken) {
        const parentNode = this.stack.peek();
        const node = this.buildNode(token.elementId, token.type, token.id, token.attributes);
        if (parentNode instanceof RootModelNode) {
            const parentDocNode = parentNode as RootModelNode<any>;
            if (!(node instanceof BlockModelNode)) {
                throw new Error('Unexpected node type.');
            }
            parentDocNode.appendChild(node);
        } else if (parentNode instanceof BlockModelNode) {
            const parentBlockNode = parentNode as BlockModelNode<any>;
            if (!(node instanceof InlineModelNode)) {
                throw new Error('Unexpected node type.');
            }
            parentBlockNode.appendChild(node);
        }
        this.stack.push(node);
        if (!this.rootNode) {
            this.rootNode = node;
        }
    }

    protected appendToContent(token: IContentToken) {
        this.contentBuffer += token;
        this.parserState = ParserState.Content;
    }

    protected closeNode(token: ICloseToken) {
        const node = this.stack.pop();
        if (!node) {
            throw new Error('Unexpected end of tokens encountered.');
        }
        if (node instanceof InlineModelNode) {
            const inlineNode = node as InlineModelNode<any>;
            inlineNode.setContent(this.contentBuffer);
        }
        this.contentBuffer = '';
        this.parserState = ParserState.NewNode;
    }

    protected buildNode(elementId: string, type: string, id: string, attributes: IAttributes) {
        const element = this.elementService.getElement(elementId);
        if (!element) {
            throw new Error(`Element ${elementId} is not registered.`);
        }
        return element.buildModelNode(type, id, attributes);
    }
}
