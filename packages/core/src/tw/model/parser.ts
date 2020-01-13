import { IComponentService } from '../component/service';
import { ICloseToken, IContentToken, IOpenToken, IToken } from '../state/token';
import { identifyTokenType } from '../state/utility';
import { IInlineModelNode, InlineModelNode } from './inline-node';
import { IAttributes, IModelNode } from './node';

export interface ITokenParser {
    parse(tokens: IToken[]): IModelNode;
}

enum ParserState {
    NewNode,
    Content,
}

interface IStackObject {
    node: IModelNode;
}

class Stack {
    protected objects: IStackObject[] = [];

    push(object: IStackObject) {
        this.objects.push(object);
    }

    pop(): IStackObject | undefined {
        return this.objects.pop();
    }

    peek(): IStackObject | undefined {
        return this.objects[this.objects.length - 1];
    }

    getDoc() {
        if (this.objects.length === 0) {
            throw new Error('Error parsing state.');
        }
        return this.objects[0];
    }
}

export class TokenParser implements ITokenParser {
    protected tokens?: IToken[];
    protected parserState: ParserState = ParserState.NewNode;
    protected rootNode?: IModelNode;
    protected stack: Stack = new Stack();
    protected contentBuffer: string = '';
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

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
                this.processToken(token);
            } catch (error) {
                error.message = `Error at token ${n}: ${error.message}`;
                throw error;
            }
        }
        this.ran = true;
    }

    protected processToken(token: IToken) {
        switch (this.parserState) {
            case ParserState.NewNode:
                switch (identifyTokenType(token)) {
                    case 'OpenToken':
                        this.newNode(token as IOpenToken);
                        return;
                    case 'ContentToken':
                        this.appendToContent(token as IContentToken);
                        return;
                    case 'CloseToken':
                        this.closeNode(token as ICloseToken);
                        return;
                }
            case ParserState.Content:
                switch (identifyTokenType(token)) {
                    case 'ContentToken':
                        this.appendToContent(token as IContentToken);
                        return;
                    case 'CloseToken':
                        this.closeNode(token as ICloseToken);
                        return;
                }
            default:
                throw new Error('Unexpected token encountered.');
        }
    }

    protected newNode(token: IOpenToken) {
        const node = this.buildNode(token.componentId, token.partId, token.id, token.attributes);
        const parentStackObject = this.stack.peek();
        if (parentStackObject) {
            parentStackObject.node.appendChild(node);
        }
        this.stack.push({ node });
        if (!this.rootNode) {
            this.rootNode = node;
        }
    }

    protected appendToContent(token: IContentToken) {
        this.contentBuffer += token;
        this.parserState = ParserState.Content;
    }

    protected closeNode(token: ICloseToken) {
        const stackObject = this.stack.pop();
        if (!stackObject) {
            throw new Error('Unexpected end of tokens encountered.');
        }
        if (stackObject.node instanceof InlineModelNode) {
            const inlineNode = stackObject.node as IInlineModelNode;
            inlineNode.setContent(this.contentBuffer);
        }
        this.contentBuffer = '';
        this.parserState = ParserState.NewNode;
    }

    protected buildNode(componentId: string, partId: string | undefined, id: string, attributes: IAttributes) {
        const component = this.componentService.getComponent(componentId);
        if (!component) {
            throw new Error(`Component ${componentId} is not registered.`);
        }
        const node = component.buildModelNode(partId, id, attributes);
        if (!node) {
            throw new Error(
                `Could not build model node from part ${partId}, id ${id} and attributes ${JSON.stringify(
                    attributes,
                )}.`,
            );
        }
        return node;
    }
}
