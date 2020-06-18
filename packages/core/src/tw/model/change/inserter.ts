import { IComponentService } from '../../component/service';
import { generateId } from '../../util/id';
import { IFragment } from '../fragment';
import { IModelNode } from '../node';
import { IModelRoot } from '../root';
import { Mutator } from './mutator';

type IInserterState = 'text' | 'split' | 'leave' | 'node' | 'end';

export class Inserter extends Mutator<IInserterState> {
    protected depth: number;
    protected current: { offset: number; index: number };
    protected internalInsertedSize = 0;

    constructor(
        protected root: IModelRoot<any>,
        offset: number,
        protected fragments: IFragment[],
        protected componentService: IComponentService,
    ) {
        super();
        this.depth = root.resolvePosition(offset).depth;
        this.current = { offset, index: 0 };
    }

    get insertedSize() {
        return this.internalInsertedSize;
    }

    protected next() {
        switch (this.state) {
            case 'text':
                this.handleText();
                break;
            case 'split':
                this.handleSplit();
                break;
            case 'leave':
                this.handleLeave();
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
        const position = this.root.resolvePosition(this.current.offset);
        const { node, index } = position.atReverseDepth(0);
        const currentFragment = this.currentFragment!;
        const content = currentFragment.content as string;
        node.replace(index, index, content);
        this.current = {
            offset: this.current.offset + currentFragment.size,
            index: this.current.index + 1,
        };
        this.internalInsertedSize += currentFragment.size;
    }

    protected handleSplit() {
        const position = this.root.resolvePosition(this.current.offset);
        const { node, offset } = position.atReverseDepth(this.currentFragment!.depth - 1);
        const insertedSize = this.splitNode(node, offset);
        this.current = {
            offset: this.current.offset + insertedSize / 2,
            index: this.current.index,
        };
        this.internalInsertedSize += insertedSize;
    }

    protected handleLeave() {
        this.current = {
            offset: this.current.offset + 1,
            index: this.current.index,
        };
    }

    protected handleNode() {
        const position = this.root.resolvePosition(this.current.offset);
        const { node, index } = position.atReverseDepth(0);
        const currentFragment = this.currentFragment!;
        const content = currentFragment.content as IModelNode<any>[];
        node.replace(index, index, content);
        if (content.length > 0) {
            this.joinNodeWithNextSibling(content[content.length - 1]);
            this.joinNodeWithPreviousSibling(content[0]);
        }
        this.current = {
            offset: this.current.offset + currentFragment.size,
            index: this.current.index + 1,
        };
        this.internalInsertedSize += currentFragment.size;
    }

    protected handleEnd() {
        this.inProgress = false;
    }

    protected get state() {
        if (!this.currentFragment) {
            return 'end';
        }
        const position = this.root.resolvePosition(this.current.offset);
        if (position.depth > this.depth - this.currentFragment.depth) {
            return 'split';
        }
        if (position.depth < this.depth - this.currentFragment.depth) {
            return 'leave';
        }
        if (this.currentFragment.depth === 0) {
            return 'text';
        }
        return 'node';
    }

    protected get currentFragment() {
        if (this.current.index >= this.fragments.length) {
            return null;
        }
        return this.fragments[this.current.index];
    }

    protected splitNode(node: IModelNode<any>, offset: number) {
        let insertedSize = 0;
        const component = this.componentService.getComponent(node.componentId);
        let position = node.resolvePosition(offset);
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
                insertedSize += this.splitNode(position.atDepth(1).node, position.atDepth(1).offset);
            }
            position = node.resolvePosition(offset + insertedSize / 2);
            node1 = component.buildModelNode(
                node.partId,
                node.id,
                '',
                node.attributes,
                node.children.slice(0, position.atDepth(0).index),
            );
            node2 = component.buildModelNode(
                node.partId,
                generateId(),
                '',
                node.attributes,
                node.children.slice(position.atDepth(0).index),
            );
        }
        const parent = node.parent!;
        const index = parent.children.indexOf(node);
        parent.replace(index, index + 1, [node1, node2]);
        insertedSize += 2;
        return insertedSize;
    }

    protected joinNodeWithNextSibling(node: IModelNode<any>) {
        const nextSibling = node.nextSibling;
        if (!nextSibling) {
            return;
        }
        if (!node.canJoin(nextSibling)) {
            return;
        }
        this.joinNodes(node, nextSibling);
    }

    protected joinNodeWithPreviousSibling(node: IModelNode<any>) {
        const previousSibling = node.previousSibling;
        if (!previousSibling) {
            return;
        }
        if (!previousSibling.canJoin(node)) {
            return;
        }
        this.joinNodes(previousSibling, node);
    }
}
