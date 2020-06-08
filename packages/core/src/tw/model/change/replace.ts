import { IComponentService } from '../../component/service';
import { IFragment } from '../fragment';
import { IModelRoot } from '../root';
import { IChange, IChangeResult } from './change';
import { Inserter } from './inserter';
import { IMapping, Mapping } from './mapping';
import { Remover } from './remover';

export class ReplaceChange implements IChange {
    constructor(protected from: number, protected to: number, protected fragments: IFragment[]) {
        this.validateInput();
    }

    apply(root: IModelRoot<any>, mappings: IMapping[], componentService: IComponentService): IChangeResult {
        this.validateFit(root);
        const { from, to } = this.map(mappings);
        const remover = new Remover(root, from, to);
        remover.run();
        const inserter = new Inserter(root, from, this.fragments, componentService);
        inserter.run();
        return {
            change: this,
            reverseChange: new ReplaceChange(from, inserter.insertedSize, remover.removedFragments),
            mapping: new Mapping(from, to - from, inserter.insertedSize),
        };
    }

    protected map(mappings: IMapping[]) {
        const from = mappings.reduce((from, mapping) => mapping.map(from), this.from);
        const to = mappings.reduce((to, mapping) => mapping.map(to), this.to);
        return { from, to };
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
