import { BlockModelNode } from '../nodes/block';
import { DocModelNode } from '../nodes/doc';
import { Merge } from './merge';

describe('Merge', () => {
    let doc: DocModelNode<{}>;

    beforeEach(() => {
        doc = new DocModelNode('doc', 'doc', {}, [
            new BlockModelNode('paragraph', 'paragraph', {}, [], 'Hello world!\n'.split('')),
            new BlockModelNode('paragraph', 'paragraph', {}, [], 'I am a test!\n'.split('')),
        ]);
    });

    describe('apply', () => {
        let operation: Merge;

        beforeEach(() => {
            operation = new Merge({ path: [], offset: 0 });
        });

        it('merges node with next sibling', () => {
            operation.apply(doc);
            expect(doc.children.length).toEqual(1);
            expect(doc.children[0].children.join('')).toEqual('Hello world!I am a test!\n');
        });
    });
});
