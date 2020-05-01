import { ModelRoot } from './root';

export class MyRoot extends ModelRoot<{}> {
    get partId() {
        return 'my-root';
    }

    toDOM(from: number, to: number): HTMLElement {
        throw new Error();
    }

    clone(): MyRoot {
        throw new Error();
    }
}

describe('ModelRoot', () => {
    let root: MyRoot;

    beforeEach(() => {
        root = new MyRoot('my-root', 'my-root', {}, '');
    });

    describe('root', () => {
        it('equals true', () => {
            expect(root.root).toEqual(true);
        });
    });

    describe('leaf', () => {
        it('equals false', () => {
            expect(root.leaf).toEqual(false);
        });
    });
});
