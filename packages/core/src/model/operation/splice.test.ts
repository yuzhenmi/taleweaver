import { BlockModelNode } from '../nodes/block';
import { DocModelNode } from '../nodes/doc';
import { Splice } from './splice';

describe('Splice', () => {
    let doc: DocModelNode<{}>;

    beforeEach(() => {
        doc = new DocModelNode('doc', 'doc', {}, [
            new BlockModelNode('paragraph', 'paragraph', {}, [], 'Hello world!\n'.split('')),
            new BlockModelNode('paragraph', 'paragraph', {}, [], 'I am a test!\n'.split('')),
        ]);
    });

    describe('apply', () => {
        let operation: Splice;

        describe('insert nodes', () => {
            beforeEach(() => {
                operation = new Splice({ path: [], offset: 2 }, 0, [
                    new BlockModelNode('paragraph', 'paragraph', {}, [], ['What is your name?\n']),
                    new BlockModelNode('paragraph', 'paragraph', {}, [], ['My name is Taleweaver!\n']),
                ]);
            });

            it('inserts nodes', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(4);
                expect(doc.children[0].children.join('')).toEqual('Hello world!\n');
                expect(doc.children[1].children.join('')).toEqual('I am a test!\n');
                expect(doc.children[2].children.join('')).toEqual('What is your name?\n');
                expect(doc.children[3].children.join('')).toEqual('My name is Taleweaver!\n');
            });
        });

        describe('remove node', () => {
            beforeEach(() => {
                operation = new Splice({ path: [], offset: 1 }, 1, []);
            });

            it('removes node', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(1);
                expect(doc.children[0].children.join('')).toEqual('Hello world!\n');
            });
        });

        describe('replace nodes', () => {
            beforeEach(() => {
                operation = new Splice({ path: [], offset: 0 }, 2, [
                    new BlockModelNode('paragraph', 'paragraph', {}, [], ['What is your name?\n']),
                    new BlockModelNode('paragraph', 'paragraph', {}, [], ['My name is Taleweaver!\n']),
                ]);
            });

            it('replaces nodes', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(2);
                expect(doc.children[0].children.join('')).toEqual('What is your name?\n');
                expect(doc.children[1].children.join('')).toEqual('My name is Taleweaver!\n');
            });
        });

        describe('insert text', () => {
            beforeEach(() => {
                operation = new Splice({ path: [0], offset: 6 }, 0, 'beautiful '.split(''));
            });

            it('inserts text', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(2);
                expect(doc.children[0].children.join('')).toEqual('Hello beautiful world!\n');
            });
        });

        describe('remove text', () => {
            beforeEach(() => {
                operation = new Splice({ path: [0], offset: 5 }, 6, []);
            });

            it('inserts text', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(2);
                expect(doc.children[0].children.join('')).toEqual('Hello!\n');
            });
        });

        describe('replace text', () => {
            beforeEach(() => {
                operation = new Splice({ path: [0], offset: 6 }, 5, 'Taleweaver'.split(''));
            });

            it('inserts text', () => {
                operation.apply(doc);
                expect(doc.children.length).toEqual(2);
                expect(doc.children[0].children.join('')).toEqual('Hello Taleweaver!\n');
            });
        });
    });
});
