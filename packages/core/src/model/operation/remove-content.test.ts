import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { IDocModelNode } from '../node';
import { Serializer } from '../serializer';
import { RemoveContent } from './remove-content';

describe('RemoveContent', () => {
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
        let operation: RemoveContent;

        describe('when removal point is within content', () => {
            beforeEach(() => {
                operation = new RemoveContent({ path: [0], offset: 5 }, 6);
            });

            it('inserts content', () => {
                operation.apply(doc);
                expect(doc.children[0].content).toEqual('Hello!\n'.split(''));
            });
        });

        describe('when removal point is outside of content', () => {
            beforeEach(() => {
                operation = new RemoveContent({ path: [0], offset: 13 }, 6);
            });

            it('throws error', () => {
                expect(() => operation.apply(doc)).toThrow(Error);
            });
        });

        describe('when removal length exceeds content', () => {
            beforeEach(() => {
                operation = new RemoveContent({ path: [0], offset: 5 }, 8);
            });

            it('throws error', () => {
                expect(() => operation.apply(doc)).toThrow(Error);
            });
        });
    });
});
