import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { BlockModelNode, IDocModelNode } from '../node';
import { Serializer } from '../serializer';
import { InsertNode } from './insert-node';

describe('InsertNode', () => {
    let componentService: ComponentService;
    let serializer: Serializer;
    let doc: IDocModelNode;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        serializer = new Serializer(componentService);
        doc = serializer.parse({
            componentId: 'doc',
            id: 'doc',
            attributes: {},
            children: [
                {
                    componentId: 'paragraph',
                    id: 'paragraph1',
                    attributes: {},
                    content: 'Hello world!',
                    marks: [],
                },
            ],
        });
    });

    describe('apply', () => {
        let operation: InsertNode;

        beforeEach(() => {
            const newBlock = new BlockModelNode('paragraph', 'paragraph2');
            newBlock.insertContent('I am new.'.split(''), 0);
            operation = new InsertNode([], 1, newBlock);
        });

        it('inserts node', () => {
            operation.apply(doc);
            expect(doc.children[1].content).toEqual('I am new.\n'.split(''));
        });
    });
});
