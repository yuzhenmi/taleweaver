import { ModelLeaf } from './leaf';

export class MyLeaf extends ModelLeaf<{}> {
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

describe('ModelLeaf', () => {
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
