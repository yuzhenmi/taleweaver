import Editor from '../Editor';
import ModelUpdatedEvent from '../events/ModelUpdatedEvent';
import StateUpdatedEvent from '../events/StateUpdatedEvent';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import DocModelNode from './DocModelNode';
import { AnyModelNode } from './ModelNode';
import StateParser from './StateParser';

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
        const [
            node,
            updatedNode,
        ] = this.findUpdatedNode(
            this.editor.getStateService().getTokens(),
            event.getBeforeFrom(),
            event.getBeforeTo(),
            event.getAfterFrom(),
            event.getAfterTo(),
        );
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

    protected findUpdatedNode(
        tokens: Token[],
        beforeFrom: number,
        beforeTo: number,
        afterFrom: number,
        afterTo: number,
    ) {
        const beforeFromPosition = this.doc.resolvePosition(beforeFrom).getLeaf();
        const beforeToPosition = this.doc.resolvePosition(beforeTo).getLeaf();
        const beforeNode = this.findCommonAncestor(
            beforeFromPosition.getNode(),
            beforeToPosition.getNode(),
        );
        const afterTokenRange = this.findParentNodeOfTokenRange(
            tokens,
            afterFrom,
            afterTo,
        );
        const afterNodeID = (tokens[afterTokenRange[0]] as OpenTagToken).getID();
        const afterNode = this.findAncestorNodeByID(beforeFromPosition.getNode(), afterNodeID);
        const node = this.findCommonAncestor(beforeNode, afterNode);
        const updatedTokens = this.findNodeTokenRange(
            tokens,
            node.getID(),
            afterTokenRange[0],
            afterTokenRange[1],
        );
        const parser = new StateParser(this.editor, updatedTokens);
        const updatedNode = parser.run();
        return [node, updatedNode];
    }

    protected findCommonAncestor(node1: AnyModelNode, node2: AnyModelNode) {
        const ancestors1: AnyModelNode[] = [];
        const ancestors2: AnyModelNode[] = [];
        let node: AnyModelNode = node1;
        while (true) {
            ancestors1.unshift(node);
            if (node.isRoot()) {
                break;
            }
            node = node.getParent();
        }
        node = node2;
        while (true) {
            ancestors2.unshift(node);
            if (node.isRoot()) {
                break;
            }
            node = node.getParent();
        }
        let index = 0;
        while (index < ancestors1.length && index < ancestors2.length) {
            if (ancestors1[index] !== ancestors2[index]) {
                break;
            }
            index++;
        }
        if (index === 0) {
            throw new Error('No common ancestor found.');
        }
        return ancestors1[index - 1];
    }

    protected findParentNodeOfTokenRange(tokens: Token[], hintFrom: number, hintTo: number) {
        let depthPeak = 0;
        let depth = 0;
        tokens.slice(hintFrom, hintTo).forEach(token => {
            if (token instanceof OpenTagToken) {
                depth--;
            } else if (token instanceof CloseTagToken) {
                depth++;
            }
            if (depth > depthPeak) {
                depthPeak = depth;
            }
        });
        let from = hintFrom;
        let opensNeeded = depthPeak + 1;
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
        let to = hintTo;
        let closesNeeded = depthPeak + 1;
        const tokensLength = tokens.length;
        while (closesNeeded > 0 && to < tokensLength) {
            to++;
            token = tokens[to - 1];
            if (token instanceof OpenTagToken) {
                closesNeeded++;
            } else if (token instanceof CloseTagToken) {
                closesNeeded--;
            }
        }
        return [from, to];
    }

    protected findNodeTokenRange(tokens: Token[], nodeID: string, hintFrom: number, hintTo: number) {
        let from = hintFrom;
        let depth = 0;
        let token: Token;
        while (from >= 0) {
            token = tokens[from];
            if (token instanceof OpenTagToken) {
                depth--;
                if (token.getID() === nodeID) {
                    break;
                }
            } else if (token instanceof CloseTagToken) {
                depth++;
            }
            from--;
        }
        let to = hintTo;
        const tokensLength = tokens.length;
        while (to < tokensLength) {
            token = tokens[to - 1];
            if (token instanceof OpenTagToken) {
                depth--;
            } else if (token instanceof CloseTagToken) {
                depth++;
                if (depth >= 0) {
                    break;
                }
            }
            to++;
        }
        return tokens.slice(from, to);
    }

    protected findAncestorNodeByID(node: AnyModelNode, id: string): AnyModelNode {
        if (node.getID() === id) {
            return node;
        }
        if (node.isRoot()) {
            throw new Error(`Ancestor node ${id} cannot be found.`);
        }
        return this.findAncestorNodeByID(node.getParent(), id);
    }
}
