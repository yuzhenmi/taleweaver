import { ComponentService } from '../../component/service';
import { ConfigServiceStub } from '../../config/service.stub';
import { IDocModelNode } from '../node';
import { Serializer } from '../serializer';
import { SetAttribute } from './set-attribute';

describe('SetAttribute', () => {
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
        let operation: SetAttribute;

        describe('when path is valid', () => {
            beforeEach(() => {
                operation = new SetAttribute([0], 'myKey', 'myValue');
            });

            it('sets attribute', () => {
                operation.apply(doc);
                expect(doc.children[0].attributes.myKey).toEqual('myValue');
            });
        });

        describe('when path is invalid', () => {
            beforeEach(() => {
                operation = new SetAttribute([1], 'myKey', 'myValue');
            });

            it('throws error', () => {
                expect(() => operation.apply(doc)).toThrow(Error);
            });
        });
    });
});
