import { IComponentService } from '../../component/service';
import { generateId } from '../../util/id';
import { IContent, IFragment } from '../fragment';
import { IModelNode } from '../node';
import { IModelPosition } from '../position';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { IMapping, Mapping } from './mapping';

class Remover {
    protected ran = false;

    constructor(protected root: IModelRoot<any>, protected from: IModelPosition, protected to: IModelPosition) {}

    run() {
        if (this.ran) {
            throw new Error('Remover already ran.');
        }
        this.remove(this.root, this.from, this.to);
        this.ran = true;
    }

    protected remove(node: IModelNode<any>, from: IModelPosition, to: IModelPosition): IFragment {
        if (node.leaf) {
            return [node.replace(from[0], to[0], '')];
        }
        const removed: IFragment = [];
        const child = node.children.at(from[0]);
        let joinedChildrenAt = 0;
        if (from[0] < to[0]) {
            removed.push(node.replace(from[0], to[0] - 1, []));
            joinedChildrenAt = child.contentLength;
            this.joinNodes(child, node.children.at(to[0]));
        }
        const removedChildFragment = this.remove(child, from.slice(1), [to[1] + joinedChildrenAt, ...to.slice(2)]);
        removed.splice(0, 0, ...removedChildFragment.slice(0, joinedChildrenAt));
        removed.push(...removedChildFragment.slice(joinedChildrenAt));
        return removed;
    }

    protected joinNodes(node1: IModelNode<any>, node2: IModelNode<any>) {
        if (node1.leaf) {
            node1.replace(0, node1.text.length, node1.text + node2.text);
        } else {
            node1.replace(0, node1.children.length, [...node1.children.slice(), ...node2.children.slice()]);
        }
        const parent = node1.parent!;
        parent.replace(
            0,
            parent.children.length,
            parent.children.filter((child) => child !== node2),
        );
    }
}

class Inserter {
    protected ran = false;

    readonly insertedTo: IModelPosition = [];

    constructor(
        protected root: IModelRoot<any>,
        protected position: IModelPosition,
        protected fragment: IFragment,
        protected componentService: IComponentService,
    ) {}

    run() {
        if (this.ran) {
            throw new Error('Inserter already ran.');
        }
        this.insert(this.root, this.position, this.fragment);
        this.ran = true;
    }

    protected insert(node: IModelNode<any>, position: IModelPosition, fragment: IFragment) {
        // TODO: Update insertedTo
        let insertAt = position[0];
        const fragmentDepth = Math.ceil(fragment.length / 2);
        const positionDepth = position.length;
        if (fragmentDepth < positionDepth) {
            this.insert(node.children.at(insertAt), position.slice(1), fragment);
            return 0;
        }

        const beforeContents = fragment.slice(0, fragmentDepth - 1);
        const afterContents = fragment.slice(fragment.length - fragmentDepth + 1);
        if (positionDepth > 1) {
            const child = node.children.at(insertAt);
            const childInsertedExtra = this.insert(child, position.slice(1), [...beforeContents, ...afterContents]);
            const splitAt = position[1] + beforeContents[beforeContents.length - 1].length + childInsertedExtra;
            const [child1, child2] = this.splitNode(child, splitAt);
            node.replace(insertAt, insertAt + 1, [child1, child2]);
            insertAt++;
        }

        const contents = fragment.slice(fragmentDepth - 1, fragment.length - fragmentDepth + 1);
        node.replace(insertAt, insertAt, this.mergeContents(contents));
        return insertAt - position[0];
    }

    protected splitNode(node: IModelNode<any>, offset: number) {
        const component = this.componentService.getComponent(node.componentId);
        let node2: IModelNode<any>;
        if (node.leaf) {
            const content2 = node.replace(0, offset, '') as string;
            node2 = component.buildModelNode(node.partId, generateId(), content2, node.attributes, []);
        } else {
            const content2 = node.replace(0, offset, []) as IModelNode<any>[];
            node2 = component.buildModelNode(node.partId, generateId(), '', node.attributes, content2);
        }
        return [node2, node];
    }

    protected mergeContents(contents: IContent[]) {
        if (typeof contents[0] === 'string') {
            const textContents = contents as string[];
            return textContents.reduce((mergedContent, content) => mergedContent + content, '');
        }
        const nodeContents = contents as IModelNode<any>[][];
        return nodeContents.reduce((mergedContent, content) => mergedContent.concat(content), []);
    }
}

export class ReplaceChange extends ModelChange {
    constructor(protected from: IModelPosition, protected to: IModelPosition, protected fragment: IFragment) {
        super();
        if (fragment.length % 2 !== 1) {
            throw new Error('Fragment is invalid.');
        }
    }

    map(mapping: IMapping) {
        const from = mapping.map(this.from);
        const to = mapping.map(this.to);
        return new ReplaceChange(from, to, this.fragment);
    }

    apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult {
        const from = this.correctPosition(root, this.from);
        const to = this.correctPosition(root, this.to);
        const remover = new Remover(root, from, to);
        remover.run();
        const inserter = new Inserter(root, from, this.fragment, componentService);
        inserter.run();
        return {
            change: this,
            reverseChange: new ReplaceChange(from, inserter.insertedTo, ['TODO']), // TODO: Set removed fragment
            mapping: new Mapping([{ from, toBefore: to, toAfter: inserter.insertedTo }]),
        };
    }

    protected correctPosition(root: IModelRoot<any>, position: IModelPosition) {
        return root.resolvePosition(position).map((resolvedOffset) => resolvedOffset.offset);
    }
}
