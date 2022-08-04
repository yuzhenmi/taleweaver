import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { BlockModelNode } from './nodes/block';
import { DocModelNode } from './nodes/doc';
import { ModelNodeData, Serializer } from './serializer';

describe('Serializer', () => {
    let componentService: ComponentService;
    let serializer: Serializer;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService as any);
        serializer = new Serializer(componentService);
    });

    describe('serialize', () => {
        let doc: DocModelNode<{}>;

        beforeEach(() => {
            doc = new DocModelNode('doc', 'doc', {}, [
                new BlockModelNode('paragraph', 'paragraph', {}, [], 'Hello world!\n'.split('')),
            ]);
        });

        it('builds serializable object from model node', () => {
            const serializable = serializer.serialize(doc);
            expect(serializable).toEqual({
                componentId: 'doc',
                id: 'doc',
                attributes: {},
                children: [
                    {
                        componentId: 'paragraph',
                        id: 'paragraph',
                        attributes: {},
                        children: ['Hello world!\n'],
                        marks: [],
                    },
                ],
            });
        });
    });

    describe('parse', () => {
        let data: ModelNodeData;

        beforeEach(() => {
            data = {
                componentId: 'doc',
                id: 'doc',
                attributes: {},
                children: [
                    {
                        componentId: 'paragraph',
                        id: 'paragraph',
                        attributes: {},
                        children: ['Hello world!\n'],
                        marks: [],
                    },
                ],
            };
        });

        it('builds model node from serializable object', () => {
            const doc = serializer.parse(data) as DocModelNode<{}>;
            expect(doc.type).toEqual('doc');
            expect(doc.componentId).toEqual('doc');
            expect(doc.id).toEqual('doc');
            expect(doc.attributes).toEqual({});
            expect(doc.children.length).toEqual(1);
            const paragraph = doc.children[0] as BlockModelNode<{}>;
            expect(paragraph.type).toEqual('block');
            expect(paragraph.componentId).toEqual('paragraph');
            expect(paragraph.id).toEqual('paragraph');
            expect(paragraph.children).toEqual('Hello world!\n'.split(''));
            expect(paragraph.marks).toEqual([]);
        });
    });
});
