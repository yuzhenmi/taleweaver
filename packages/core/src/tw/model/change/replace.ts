import { IComponentService } from '../../component/service';
import { IFragment } from '../fragment';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { Inserter } from './util/inserter';
import { IMapping, Mapping } from './mapping';
import { Remover } from './util/remover';
import { IModelNode } from '../node';
import { join } from './util/join';

export class ReplaceChange extends ModelChange {
    constructor(protected from: number, protected to: number, protected fragments: IFragment[]) {
        super();
        this.validateInput();
    }

    map(mapping: IMapping) {
        const from = mapping.map(this.from);
        const to = mapping.map(this.to);
        return new ReplaceChange(from, to, this.fragments);
    }

    apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult {
        this.validateFit(root);
        const remover = new Remover(root, this.from, this.to);
        remover.run();
        const inserter = new Inserter(root, this.from, this.fragments, componentService);
        inserter.run();
        let insertedSize = inserter.insertedSize;
        const toPosition = root.resolvePosition(this.from + insertedSize);
        if (toPosition.atReverseDepth(0).offset === 1) {
            if (this.fragments.length === 0 || this.fragments[this.fragments.length - 1].depth === 0) {
                insertedSize += this.joinWithPreviousSibling(toPosition.atReverseDepth(0).node);
            }
        }
        return {
            change: this,
            reverseChange: new ReplaceChange(this.from, this.from + insertedSize, remover.removedFragments),
            mapping: new Mapping(this.from, this.to - this.from, insertedSize),
        };
    }

    protected validateInput() {
        // Validate range is valid
        if (this.from > this.to) {
            throw new Error('Range is invalid.');
        }
        // Validate fragments depths are valid
        if (this.fragments.length > 0) {
            let ascending = true;
            let descending = false;
            let depth = this.fragments[0].depth;
            for (let n = 1, nn = this.fragments.length; n < nn; n++) {
                const fragment = this.fragments[n];
                if (fragment.depth > depth) {
                    if (!ascending) {
                        throw new Error('Fragments have invalid depths.');
                    }
                } else if (fragment.depth < depth) {
                    if (ascending) {
                        ascending = false;
                        descending = true;
                    }
                    if (!descending) {
                        throw new Error('Fragments have invalid depths.');
                    }
                }
                depth = fragment.depth;
            }
        }
    }

    protected validateFit(root: IModelRoot<any>) {
        // Fragments depths must be less than depth at from position
        const fromPosition = root.resolvePosition(this.from);
        const maxFragmentDepth = Math.max(...this.fragments.map((fragment) => fragment.depth));
        if (maxFragmentDepth >= fromPosition.depth) {
            throw new Error('Fragments do not fit in range.');
        }
    }

    protected joinWithPreviousSibling(node: IModelNode<any>): number {
        let previousSibling = node.previousSibling;
        if (!previousSibling) {
            if (node.parent) {
                return this.joinWithPreviousSibling(node.parent);
            }
            return 0;
        }
        const childNodeToJoin = node.firstChild;
        join(previousSibling, node);
        let insertedSize = 2;
        if (childNodeToJoin) {
            insertedSize += this.joinWithPreviousSibling(childNodeToJoin);
        }
        return insertedSize;
    }
}
