import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { IDocModelNode } from '../node';
import { Serializer } from '../serializer';
import { RemoveNode } from './remove-node';

describe('RemoveNode', () => {
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
                {
                    componentId: 'paragraph',
                    id: 'paragraph2',
                    attributes: {},
                    content: 'Second paragraph.',
                    marks: [],
                },
            ],
        });
    });

    describe('apply', () => {
        let operation: RemoveNode;

        beforeEach(() => {
            operation = new RemoveNode([], 1);
        });

        it('removes node', () => {
            expect(doc.children.length).toEqual(2);
            operation.apply(doc);
            expect(doc.children.length).toEqual(1);
        });
    });
});
