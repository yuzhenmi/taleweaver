import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { BlockModelNode, DocModelNode } from './node';
import { ISerializable, Serializer } from './serializer';

describe('Serializer', () => {
    let componentService: ComponentService;
    let serializer: Serializer;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        serializer = new Serializer(componentService);
    });

    describe('serialize', () => {
        let doc: DocModelNode;

        beforeEach(() => {
            doc = new DocModelNode('doc', 'doc');
            const paragraph = new BlockModelNode('paragraph', 'paragraph');
            paragraph.insertContent('Hello world!'.split(''), 0);
            doc.insertChild(paragraph, 0);
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
                        content: 'Hello world!',
                        children: [],
                        marks: [],
                    },
                ],
            });
        });
    });

    describe('parse', () => {
        let data: ISerializable;

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
                        content: 'Hello world!',
                        children: [],
                        marks: [],
                    },
                ],
            };
        });

        it('builds model node from serializable object', () => {
            const doc = serializer.parse(data) as DocModelNode;
            expect(doc.type).toEqual('doc');
            expect(doc.componentId).toEqual('doc');
            expect(doc.id).toEqual('doc');
            expect(doc.attributes).toEqual({});
            expect(doc.children.length).toEqual(1);
            const paragraph = doc.children[0] as BlockModelNode;
            expect(paragraph.type).toEqual('block');
            expect(paragraph.componentId).toEqual('paragraph');
            expect(paragraph.id).toEqual('paragraph');
            expect(paragraph.content).toEqual('Hello world!\n'.split(''));
            expect(paragraph.marks).toEqual([]);
        });
    });
});
