import { IFragment } from '../fragment';
import { Inserter } from '../mutator/inserter';
import { Remover } from '../mutator/remover';
import { IModelRoot } from '../root';
import { IChange, IChangeResult } from './change';

export class ReplaceChange implements IChange {
    constructor(readonly from: number, readonly to: number, readonly fragments: IFragment[]) {
        this.validateInput();
    }

    apply(root: IModelRoot<any>): IChangeResult {
        this.validateFit(root);
        const remover = new Remover(root, this.from, this.to);
        remover.run();
        const removedFragments = remover.removedFragments;
        const inserter = new Inserter(root, this.from, this.fragments);
        inserter.run();
        return {
            change: this,
            reverseChange: new ReplaceChange(
                this.from,
                // TODO: Take depths into account when determining fragments size
                this.from + this.fragments.reduce((size, fragment) => size + fragment.size, 0),
                removedFragments,
            ),
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
}
