import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { DocModelNode } from '../nodes/doc';
import { Serializer } from '../serializer';
import { SetAttribute } from './set-attribute';

describe('SetAttribute', () => {
    let componentService: ComponentService;
    let serializer: Serializer;
    let doc: DocModelNode<{}>;

    beforeEach(() => {
        const configService = new ConfigServiceStub();
        componentService = new ComponentService(configService as any);
        serializer = new Serializer(componentService);
        doc = serializer.parse({
            componentId: 'doc',
            id: 'doc',
            attributes: {},
            children: [
                {
                    componentId: 'paragraph',
                    id: 'paragraph1',
                    attributes: { myAttribute: 'myValue' },
                    marks: [],
                    children: 'Hello world!\n'.split(''),
                },
            ],
        });
    });

    describe('apply', () => {
        let operation: SetAttribute<{ myAttribute: string }>;

        describe('when path is valid', () => {
            beforeEach(() => {
                operation = new SetAttribute({ path: [], offset: 0 }, { myAttribute: 'myNewValue' });
            });

            it('sets attribute', () => {
                operation.apply(doc);
                expect(doc.children[0].attributes.myAttribute).toEqual('myNewValue');
            });
        });

        describe('when path is invalid', () => {
            beforeEach(() => {
                operation = new SetAttribute({ path: [], offset: 1 }, { myAttribute: 'myNewValue' });
            });

            it('throws error', () => {
                expect(() => operation.apply(doc)).toThrow(Error);
            });
        });
    });
});
