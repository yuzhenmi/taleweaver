import { ModelBranch } from './branch';

export class MyBranch extends ModelBranch<{}> {
    get partId() {
        return 'my-branch';
    }

    toDOM(from: number, to: number): HTMLElement {
        throw new Error();
    }

    clone(): MyBranch {
        throw new Error();
    }
}

describe('ModelBranch', () => {
    let branch: MyBranch;

    beforeEach(() => {
        branch = new MyBranch('my-branch', 'my-branch', '', {});
    });

    describe('root', () => {
        it('equals false', () => {
            expect(branch.root).toEqual(false);
        });
    });

    describe('leaf', () => {
        it('equals false', () => {
            expect(branch.leaf).toEqual(false);
        });
    });
});
