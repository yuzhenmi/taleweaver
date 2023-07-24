import { BlockModelNode } from '../nodes/block';
import { DocModelNode } from '../nodes/doc';
import { Split } from './split';

describe('Split', () => {
    let doc: DocModelNode<{}>;

    beforeEach(() => {
        doc = new DocModelNode('doc', 'doc', {}, [
            new BlockModelNode('paragraph', 'paragraph', {}, [], 'Hello world!\n'.split('')),
        ]);
    });

    describe('apply', () => {
        let operation: Split;

        beforeEach(() => {
            operation = new Split({ path: [0], offset: 6 });
        });

        it('splits node', () => {
            operation.apply(doc);
            expect(doc.children.length).toEqual(2);
            expect(doc.children[0].children.join('')).toEqual('Hello \n');
            expect(doc.children[1].children.join('')).toEqual('world!\n');
        });
    });
});
