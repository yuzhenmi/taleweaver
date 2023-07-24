import { ComponentService } from '../component/service';
import { stubConfigService } from '../config/service.stub';
import { ModelNode } from './node';
import { SerializedData, Serializer } from './serializer';

describe('Serializer', () => {
    let componentService: ComponentService;
    let serializer: Serializer;

    beforeEach(() => {
        const configService = stubConfigService();
        componentService = new ComponentService(configService);
        serializer = new Serializer(componentService);
    });

    describe('serialize', () => {
        let root: ModelNode<{}>;

        beforeEach(() => {
            root = new ModelNode({
                componentId: 'doc',
                id: 'doc',
                props: {},
                marks: [],
                children: [
                    new ModelNode({
                        componentId: 'paragraph',
                        id: 'paragraph',
                        props: {},
                        marks: [],
                        children: 'Hello world!'.split(''),
                    }),
                ],
            });
        });

        it('builds serialized data from model node', () => {
            const data = serializer.serialize(root);
            expect(data).toEqual({
                componentId: 'doc',
                id: 'doc',
                props: {},
                children: [
                    {
                        componentId: 'paragraph',
                        id: 'paragraph',
                        props: {},
                        children: ['Hello world!'],
                    },
                ],
            });
        });
    });

    describe('parse', () => {
        let data: SerializedData;

        beforeEach(() => {
            data = {
                componentId: 'doc',
                id: 'doc',
                props: {},
                children: [
                    {
                        componentId: 'paragraph',
                        id: 'paragraph',
                        props: {},
                        children: ['Hello world!'],
                    },
                ],
            };
        });

        it('builds model node from serialized data', () => {
            const root = serializer.parse(data);
            expect(root.componentId).toEqual('doc');
            expect(root.id).toEqual('doc');
            expect(root.props).toEqual({});
            expect(root.children.length).toEqual(1);
            const paragraph = root.children[0] as ModelNode<unknown>;
            expect(paragraph.componentId).toEqual('paragraph');
            expect(paragraph.id).toEqual('paragraph');
            expect(paragraph.marks).toEqual([]);
            expect(paragraph.children).toEqual('Hello world!'.split(''));
        });
    });
});
