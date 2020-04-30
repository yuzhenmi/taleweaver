import { MyBranch } from './branch.test';
import { MyLeaf } from './leaf.test';
import { ModelNode } from './node';

describe('ModelNode', () => {
    let node: ModelNode<any>;

    describe('text', () => {
        beforeEach(() => {
            node = new MyLeaf('my-leaf', 'my-leaf', {}, 'My text.');
        });

        it('equals text', () => {
            expect(node.text).toEqual('My text.');
        });
    });

    describe('size', () => {
        describe('not leaf', () => {
            beforeEach(() => {
                node = new MyBranch('my-branch', 'my-branch', {}, '');
                node.appendChild(new MyLeaf('my-leaf', 'my-leaf', {}, 'My text.'));
                node.appendChild(new MyLeaf('my-leaf', 'my-other-leaf', {}, 'My other text.'));
            });

            it('equals sum of size of children plus padding', () => {
                expect(node.size).toEqual(24);
            });
        });

        describe('leaf', () => {
            beforeEach(() => {
                node = new MyLeaf('my-leaf', 'my-leaf', {}, 'My text.');
            });

            it('equals length of text plus padding', () => {
                expect(node.size).toEqual(10);
            });
        });
    });

    describe('resolvePosition', () => {
        // TODO
    });

    describe('toTokens', () => {
        // TODO
    });
});
