import { MyBranch } from './branch.test';
import { MyLeaf } from './leaf.test';
import { ModelNode } from './node';

describe('ModelNode', () => {
    let node: ModelNode<any>;

    describe('text', () => {
        beforeEach(() => {
            node = new MyLeaf('my-leaf', 'my-leaf', 'My text.', {});
        });

        it('equals text', () => {
            expect(node.text).toEqual('My text.');
        });
    });

    describe('size', () => {
        describe('not leaf', () => {
            beforeEach(() => {
                node = new MyBranch('my-branch', 'my-branch', '', {});
                node.setChildren([
                    new MyLeaf('my-leaf', 'my-leaf', 'My text.', {}),
                    new MyLeaf('my-leaf', 'my-other-leaf', 'My other text.', {}),
                ]);
            });

            it('equals sum of size of children plus padding', () => {
                expect(node.size).toEqual(28);
            });
        });

        describe('leaf', () => {
            beforeEach(() => {
                node = new MyLeaf('my-leaf', 'my-leaf', 'My text.', {});
            });

            it('equals length of text plus padding', () => {
                expect(node.size).toEqual(10);
            });
        });
    });

    describe('needRender', () => {
        it('initializes to true', () => {
            expect(node.needRender).toEqual(true);
        });

        describe('clearNeedRender called', () => {
            it('clears needRender flag', () => {
                node.clearNeedRender();
                expect(node.needRender).toEqual(false);
            });
        });

        describe('children updated', () => {
            it('sets needRender flag to true', () => {
                node.clearNeedRender();
                node.setChildren([]);
                expect(node.needRender).toEqual(true);
            });
        });
    });
});
