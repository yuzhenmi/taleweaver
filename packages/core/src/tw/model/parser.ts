import { IComponentService } from '../component/service';
import { ICloseToken, IContentToken, IOpenToken, IToken } from '../state/token';
import { identifyTokenType } from '../state/utility';
import { IModelNode } from './node';

export interface ITokenParser {
    parse(tokens: IToken[]): IModelNode<any>;
}

enum ParserState {
    NewNode,
    Content,
}

interface INodeDescription {
    componentId: string;
    partId: string | null;
    id: string;
    attributes: {};
    text: string;
    childrenDescriptions: INodeDescription[];
    children: IModelNode<any>[];
}

class Stack {
    protected nodeDescriptions: INodeDescription[] = [];

    push(object: INodeDescription) {
        this.nodeDescriptions.push(object);
    }

    pop(): INodeDescription | undefined {
        return this.nodeDescriptions.pop();
    }

    peek(): INodeDescription | undefined {
        return this.nodeDescriptions[this.nodeDescriptions.length - 1];
    }

    getDoc() {
        if (this.nodeDescriptions.length === 0) {
            throw new Error('Error parsing state.');
        }
        return this.nodeDescriptions[0];
    }
}

export class TokenParser implements ITokenParser {
    protected tokens?: IToken[];
    protected parserState: ParserState = ParserState.NewNode;
    protected root?: IModelNode<any>;
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
        return this.root!;
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
        const nodeDescription = {
            componentId: token.componentId,
            partId: token.partId,
            id: token.id,
            attributes: token.attributes,
            text: '',
            childrenDescriptions: [],
            children: [],
        };
        const parentStackObject = this.stack.peek();
        if (parentStackObject) {
            parentStackObject.childrenDescriptions.push(nodeDescription);
        }
        this.stack.push(nodeDescription);
    }

    protected appendToContent(token: IContentToken) {
        this.contentBuffer += token;
        this.parserState = ParserState.Content;
    }

    protected closeNode(token: ICloseToken) {
        const nodeDescription = this.stack.pop();
        if (!nodeDescription) {
            throw new Error('Unexpected end of tokens encountered.');
        }
        const node = this.buildNode(nodeDescription, this.contentBuffer);
        const parentNodeDescription = this.stack.peek();
        if (parentNodeDescription) {
            parentNodeDescription.children.push(node);
        } else {
            if (!node.root) {
                throw new Error('Root node is not marked as root.');
            }
            this.root = node;
        }
        this.contentBuffer = '';
        this.parserState = ParserState.NewNode;
    }

    protected buildNode({ componentId, partId, id, attributes, children }: INodeDescription, text: string) {
        const component = this.componentService.getComponent(componentId);
        const node = component.buildModelNode(partId, id, attributes, text);
        if (!node) {
            throw new Error(
                `Could not build node with component ${componentId}, part ${partId}, id ${id} and attributes ${JSON.stringify(
                    attributes,
                )}.`,
            );
        }
        node.setChildren(children);
        return node;
    }
}
