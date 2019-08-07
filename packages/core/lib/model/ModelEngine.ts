import Editor from '../Editor';
import ModelUpdatedEvent from '../events/ModelUpdatedEvent';
import StateUpdatedEvent from '../events/StateUpdatedEvent';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import DocModelNode from './DocModelNode';
import { AnyModelNode } from './ModelNode';
import ModelPosition from './ModelPosition';
import TokenParser from './StateParser';

export default class ModelEngine {
    protected editor: Editor;
    protected doc: DocModelNode;

    constructor(editor: Editor) {
        this.editor = editor;
        this.doc = new DocModelNode(editor);
        editor.getDispatcher().on(StateUpdatedEvent, this.handleStateUpdatedEvent);
    }

    getDoc() {
        return this.doc;
    }

    protected handleStateUpdatedEvent = (event: StateUpdatedEvent) => {
        const position = this.doc.resolvePosition(event.getBeforeFrom());
        const tokens = this.editor.getStateService().getTokens();
        let from = event.getAfterFrom();
        let to = event.getAfterTo();
        let depthPeak = 0;
        let depth = 0;
        tokens.slice(from, to).forEach(token => {
            if (token instanceof OpenTagToken) {
                depth--;
            } else if (token instanceof CloseTagToken) {
                depth++;
            }
            if (depth > depthPeak) {
                depthPeak = depth;
            }
        });
        let opensNeeded = depthPeak + 1;
        let closesNeeded = depthPeak + 1;
        let token: Token;
        while (opensNeeded > 0 && from > 0) {
            from--;
            token = tokens[from];
            if (token instanceof OpenTagToken) {
                opensNeeded--;
            } else if (token instanceof CloseTagToken) {
                opensNeeded++;
            }
        }
        const maxTokenIndex = tokens.length;
        while (closesNeeded > 0 && to < maxTokenIndex) {
            to++;
            token = tokens[to - 1];
            if (token instanceof OpenTagToken) {
                closesNeeded++;
            } else if (token instanceof CloseTagToken) {
                closesNeeded--;
            }
        }
        const parser = new TokenParser(this.editor, tokens.slice(from, to));
        const updatedNode = parser.run();
        let node: AnyModelNode | null = null;
        let currentPosition: ModelPosition | null = position;
        while (currentPosition) {
            if (currentPosition.getNode().getID() === updatedNode.getID()) {
                node = currentPosition.getNode();
                break;
            }
            currentPosition = currentPosition.getChild();
        }
        if (!node) {
            throw new Error('Error identifying updated model node.');
        }
        node.onUpdated(updatedNode);
        this.clearAncestorsCache(node);
        this.editor.getDispatcher().dispatch(new ModelUpdatedEvent(node));
    }

    protected clearAncestorsCache(node: AnyModelNode) {
        let currentNode = node;
        while (true) {
            currentNode.clearCache();
            if (currentNode.isRoot()) {
                break;
            }
            currentNode = currentNode.getParent();
        }
    }
}
