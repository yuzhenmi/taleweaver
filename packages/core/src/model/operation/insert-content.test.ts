import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { IDocModelNode } from '../node';
import { Serializer } from '../serializer';
import { InsertContent } from './insert-content';

describe('InsertContent', () => {
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
        let operation: InsertContent;

        describe('when insertion point is within content', () => {
            beforeEach(() => {
                operation = new InsertContent(
                    { path: [0], offset: 5 },
                    ' beautiful'.split(''),
                );
            });

            it('inserts content', () => {
                operation.apply(doc);
                expect(doc.children[0].content).toEqual(
                    'Hello beautiful world!\n'.split(''),
                );
            });
        });

        describe('when insertion point is outside of content', () => {
            beforeEach(() => {
                operation = new InsertContent(
                    { path: [0], offset: 13 },
                    ' beautiful'.split(''),
                );
            });

            it('throws error', () => {
                expect(() => operation.apply(doc)).toThrow(Error);
            });
        });
    });
});
