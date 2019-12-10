import { IComponentService } from 'tw/component/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener, IOnEvent } from 'tw/event/listener';
import { IDocModelNode } from 'tw/model/doc-node';
import { IModelNode } from 'tw/model/node';
import { TokenParser } from 'tw/model/parser';
import { IStateService } from 'tw/state/service';
import { IDidUpdateStateEvent } from 'tw/state/state';
import { IOpenToken, IToken } from 'tw/state/token';
import { identityTokenType } from 'tw/state/utility';
import { findCommonLineage } from 'tw/tree/utility';

export interface IDidUpdateModelStateEvent {
    readonly node: IModelNode;
}

export interface IModelState {
    onDidUpdateModelState: IOnEvent<IDidUpdateModelStateEvent>;
    getDocNode(): IDocModelNode;
}

export class ModelState implements IModelState {
    protected docNode: IDocModelNode;
    protected didUpdateModelStateEventEmitter: IEventEmitter<IDidUpdateModelStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected stateService: IStateService) {
        const tokens = stateService.getTokens();
        const parser = new TokenParser(componentService);
        this.docNode = parser.parse(tokens) as IDocModelNode;
        stateService.onDidUpdateState(event => this.handleDidUpdateStateEvent(event));
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.didUpdateModelStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateStateEvent(event: IDidUpdateStateEvent) {
        const node = this.findNodeContainingRange(event.beforeFrom, event.beforeTo);
        const updatedTokens = this.findNodeTokenRange(
            this.stateService.getTokens(),
            node.getId(),
            event.afterFrom,
            event.afterTo,
        );
        // TODO: When there is block insertion or deletion, it
        // results in reparse of the full token state. While this
        // is unnoticeable for small documents, it gets noticeably
        // slow as the documents grows large. There is much room
        // for optimization, by only reparsing the part of the token
        // state that got updated.
        const parser = new TokenParser(this.componentService);
        const updatedNode = parser.parse(updatedTokens);
        node.onUpdated(updatedNode);
        this.didUpdateModelStateEventEmitter.emit({ node });
    }

    protected findUpdatedNode(
        tokens: IToken[],
        beforeFrom: number,
        beforeTo: number,
        afterFrom: number,
        afterTo: number,
    ) {
        const beforeFromPosition = this.docNode.resolvePosition(beforeFrom).getLeaf();
        const beforeToPosition = this.docNode.resolvePosition(beforeTo).getLeaf();
        const beforeNode = findCommonLineage(beforeFromPosition.getNode(), beforeToPosition.getNode());
        const afterTokenRange = this.findParentNodeOfTokenRange(tokens, afterFrom, afterTo);
        const afterNodeID = (tokens[afterTokenRange[0]] as IOpenToken).id;
        const afterNode = this.findNodeInLineageById(beforeFromPosition.getNode(), afterNodeID);
        const node = findCommonLineage(beforeNode, afterNode);
        const updatedTokens = this.findNodeTokenRange(tokens, node.getId(), afterTokenRange[0], afterTokenRange[1]);
        const parser = new TokenParser(this.componentService);
        const updatedNode = parser.parse(updatedTokens);
        return [node, updatedNode];
    }

    protected findNodeContainingRange(from: number, to: number) {
        const fromPosition = this.docNode.resolvePosition(from).getLeaf();
        const toPosition = this.docNode.resolvePosition(to).getLeaf();
        return findCommonLineage(fromPosition.getNode(), toPosition.getNode()) as IModelNode;
    }

    protected findParentNodeOfTokenRange(tokens: IToken[], hintFrom: number, hintTo: number) {
        let depthPeak = 0;
        let depth = 0;
        tokens.slice(hintFrom, hintTo).forEach(token => {
            switch (identityTokenType(token)) {
                case 'OpenToken':
                    depth--;
                    break;
                case 'CloseToken':
                    depth++;
                    break;
            }
            if (depth > depthPeak) {
                depthPeak = depth;
            }
        });
        let from = hintFrom;
        let opensNeeded = depthPeak + 1;
        let token: IToken;
        while (opensNeeded > 0 && from > 0) {
            from--;
            token = tokens[from];
            switch (identityTokenType(token)) {
                case 'OpenToken':
                    opensNeeded--;
                    break;
                case 'CloseToken':
                    opensNeeded++;
                    break;
            }
        }
        let to = hintTo;
        let closesNeeded = depthPeak + 1;
        const tokensLength = tokens.length;
        while (closesNeeded > 0 && to < tokensLength) {
            to++;
            token = tokens[to - 1];
            switch (identityTokenType(token)) {
                case 'OpenToken':
                    closesNeeded++;
                    break;
                case 'CloseToken':
                    closesNeeded--;
                    break;
            }
        }
        return [from, to];
    }

    protected findNodeInLineageById(node: IModelNode, id: string): IModelNode {
        if (node.getId() === id) {
            return node;
        }
        if (node.isRoot()) {
            throw new Error(`Node ${id} is not found in lineage.`);
        }
        return this.findNodeInLineageById(node.getParent()!, id);
    }

    protected findNodeTokenRange(tokens: IToken[], nodeId: string, hintFrom: number, hintTo: number) {
        const [from, depth] = this.findNodeOpenTokenPositionAndDepth(tokens, nodeId, hintFrom);
        const to = this.findNodeCloseTokenPosition(tokens, nodeId, hintTo, depth);
        return tokens.slice(from, to);
    }

    protected findNodeOpenTokenPositionAndDepth(tokens: IToken[], nodeId: string, hintPosition: number) {
        let position = hintPosition;
        let depth = 0;
        let token: IToken;
        while (position >= 0) {
            token = tokens[position];
            switch (identityTokenType(token)) {
                case 'OpenToken':
                    depth--;
                    if ((token as IOpenToken).id === nodeId) {
                        return [position, depth];
                    }
                    break;
                case 'CloseToken':
                    depth++;
                    break;
            }
            position--;
        }
        return [position, depth];
    }

    protected findNodeCloseTokenPosition(tokens: IToken[], nodeId: string, hintPosition: number, depth: number) {
        const tokensLength = tokens.length;
        let position = hintPosition;
        let currentDepth = depth;
        let token: IToken;
        while (position < tokensLength) {
            token = tokens[position - 1];
            switch (identityTokenType(token)) {
                case 'OpenToken':
                    currentDepth--;
                    break;
                case 'CloseToken':
                    currentDepth++;
                    if (currentDepth >= 0) {
                        return position;
                    }
                    break;
            }
            position++;
        }
        return position;
    }
}
