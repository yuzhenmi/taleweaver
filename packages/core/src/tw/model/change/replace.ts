import { IComponentService } from '../../component/service';
import { IFragment } from '../fragment';
import { IModelRoot } from '../root';
import { IModelChangeResult, ModelChange } from './change';
import { Inserter } from './inserter';
import { IMapping, Mapping } from './mapping';
import { Remover } from './remover';

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

    apply(root: IModelRoot<any>, componentService: IComponentService): IModelChangeResult {
        this.validateFit(root);
        const remover = new Remover(root, this.from, this.to);
        remover.run();
        const inserter = new Inserter(root, this.from, this.fragments, componentService);
        inserter.run();
        return {
            change: this,
            reverseChange: new ReplaceChange(this.from, this.from + inserter.insertedSize, remover.removedFragments),
            mapping: new Mapping(this.from, this.to - this.from, inserter.insertedSize),
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
