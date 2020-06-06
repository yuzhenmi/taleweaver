import { IComponentService } from '../../component/service';
import { generateId } from '../../util/id';
import { IFragment } from '../fragment';
import { IModelNode } from '../node';
import { IModelRoot } from '../root';
import { Mutator } from './mutator';

type IInserterState = 'text' | 'split' | 'node' | 'end';

export class Inserter extends Mutator<IInserterState> {
    protected currentOffset: number;
    protected currentIndex = 0;

    constructor(
        protected root: IModelRoot<any>,
        offset: number,
        protected fragments: IFragment[],
        protected componentService: IComponentService,
    ) {
        super();
        this.currentOffset = offset;
    }

    protected next() {
        switch (this.state) {
            case 'text':
                this.handleText();
                break;
            case 'split':
                this.handleSplit();
                break;
            case 'node':
                this.handleNode();
                break;
            case 'end':
                this.handleEnd();
                break;
        }
    }

    protected handleText() {
        const position = this.root.resolvePosition(this.currentOffset);
        const { node, index } = position.atDepth(position.depth - 1);
        const currentFragment = this.currentFragment!;
        const content = currentFragment.content as string;
        node.replace(index, index, content);
    }

    protected handleSplit() {
        const position = this.root.resolvePosition(this.currentOffset);
        const { node, offset } = position.atDepth(position.depth - this.currentFragment!.depth);
        this.splitNode(node, offset);
    }

    protected handleNode() {
        const position = this.root.resolvePosition(this.currentOffset);
        const { node, index } = position.atDepth(position.depth - 1 - this.currentFragment!.depth);
        const currentFragment = this.currentFragment!;
        const content = currentFragment.content as IModelNode<any>[];
        node.replace(index, index, content);
        this.joinNodeWithNextSibling(content[content.length - 1]);
        this.joinNodeWithPreviousSibling(content[0]);
    }

    protected handleEnd() {
        this.inProgress = false;
    }

    protected get state() {
        if (!this.currentFragment) {
            return 'end';
        }
        if (this.currentFragment.depth === 0) {
            return 'text';
        }
        const position = this.root.resolvePosition(this.currentOffset);
        if (position.atDepth(position.depth - 1).offset === 0) {
            return 'split';
        }
        return 'node';
    }

    protected get currentFragment() {
        if (this.currentIndex >= this.fragments.length) {
            return null;
        }
        return this.fragments[this.currentIndex];
    }

    protected splitNode(node: IModelNode<any>, offset: number) {
        const component = this.componentService.getComponent(node.componentId);
        const position = node.resolvePosition(offset);
        let node1: IModelNode<any>;
        let node2: IModelNode<any>;
        if (position.depth === 1) {
            node1 = component.buildModelNode(
                node.partId,
                node.id,
                node.text.substring(0, offset - 1),
                node.attributes,
                [],
            );
            node2 = component.buildModelNode(
                node.partId,
                generateId(),
                node.text.substring(offset - 1),
                node.attributes,
                [],
            );
        } else {
            if (position.atDepth(1).offset !== 0) {
                this.splitNode(position.atDepth(1).node, position.atDepth(1).offset);
            }
            node1 = component.buildModelNode(node.partId, node.id, '', node.attributes, node.children.slice(0, offset));
            node2 = component.buildModelNode(
                node.partId,
                generateId(),
                '',
                node.attributes,
                node.children.slice(offset),
            );
        }
        node.replace(position.atDepth(1).index, position.atDepth(1).index + 1, [node1, node2]);
    }
}
