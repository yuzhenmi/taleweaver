import { Leaf } from './leaf';

export class MyLeaf extends Leaf<{}> {
    get partId() {
        return 'my-leaf';
    }

    toDOM(from: number, to: number): HTMLElement {
        throw new Error();
    }

    clone(): MyLeaf {
        throw new Error();
    }
}

describe('Leaf', () => {
    let leaf: MyLeaf;

    beforeEach(() => {
        leaf = new MyLeaf('my-leaf', 'my-leaf', {}, '');
    });

    describe('root', () => {
        it('equals false', () => {
            expect(leaf.root).toEqual(false);
        });
    });

    describe('leaf', () => {
        it('equals true', () => {
            expect(leaf.leaf).toEqual(true);
        });
    });
});
