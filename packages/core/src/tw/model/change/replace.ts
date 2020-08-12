import { IComponentService } from '../../component/service';
import { IFragment } from '../fragment';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { IMapping, Mapping } from './mapping';
import { IPosition } from '../position';
import { IModelNode } from '../node';
import { generateId } from '../../util/id';

class Remover {
    protected ran = false;

    constructor(protected root: IModelRoot<any>, protected from: IPosition, protected to: IPosition) {}

    run() {
        if (this.ran) {
            throw new Error('Remover already ran.');
        }
        this.remove(this.root, this.from, this.to);
        this.ran = true;
    }

    protected remove(node: IModelNode<any>, from: IPosition, to: IPosition): IFragment {
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

    constructor(
        protected root: IModelRoot<any>,
        protected position: IPosition,
        protected fragment: IFragment,
        protected componentService: IComponentService,
    ) {}

    run() {
        if (this.ran) {
            throw new Error('Inserter already ran.');
        }
        this.insert(null, this.root, this.position, this.fragment);
        this.ran = true;
    }

    protected insert(ownOffset: number | null, node: IModelNode<any>, position: IPosition, fragment: IFragment) {
        if (Math.ceil(fragment.length / 2) < position.length) {
            this.insert(position[0], node.children.at(position[0]), position.slice(1), fragment);
            return;
        }

        if (fragment.length % 2 === 1) {
            const contentIndex = (fragment.length - 1) / 2;
            if (position.length > 1) {
                this.insert(position[0], node.children.at(position[0]), position.slice(1), [
                    ...fragment.slice(0, contentIndex),
                    ...fragment.slice(contentIndex + 1),
                ]);
            }
            const content = fragment[contentIndex];
            if (node.leaf) {
                node.replace(position[0], position[0], content);
            } else {
                node.replace(position[0] + 1, position[0] + 1, content);
            }
            return;
        }

        const contentIndex1 = fragment.length / 2 - 1;
        const contentIndex2 = fragment.length / 2;
        if (position.length > 1) {
            this.insert(position[0], node.children.at(position[0]), position.slice(1), [
                ...fragment.slice(0, contentIndex1),
                ...fragment.slice(contentIndex2 + 1),
            ]);
        }
        const content1 = fragment[contentIndex1];
        const content2 = fragment[contentIndex2];
        const component = this.componentService.getComponent(node.componentId);
        let node2: IModelNode<any>;
        if (node.leaf) {
            const text2 = node.text.substring(position[0]) as string;
            node.replace(position[0], node.contentLength, content1);
            node2 = component.buildModelNode(
                node.partId,
                generateId(),
                (content2 as string) + text2,
                node.attributes,
                [],
            );
        } else {
            const children2 = node.children.slice(position[0] + 1) as IModelNode<any>[];
            node.replace(position[0] + 1, node.contentLength, content1);
            node2 = component.buildModelNode(node.partId, generateId(), '', node.attributes, [
                ...(content2 as IModelNode<any>[]),
                ...children2,
            ]);
        }
        node.parent!.replace(ownOffset! + 1, ownOffset! + 1, [node2]);
    }
}

export class ReplaceChange extends ModelChange {
    constructor(protected from: IPosition, protected to: IPosition, protected fragment: IFragment) {
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
        const remover = new Remover(root, this.from, this.to);
        remover.run();
        const inserter = new Inserter(root, this.from, this.fragment, componentService);
        inserter.run();
        return {
            change: this,
            reverseChange: new ReplaceChange(this.from, this.from, ['TODO']), // TODO: Set removed fragment
            mapping: new Mapping([{ from: this.from, toBefore: this.to, toAfter: this.to }]),
        };
    }
}
