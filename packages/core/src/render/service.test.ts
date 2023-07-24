import { ComponentService } from '../component/service';
import { ConfigService } from '../config/service';
import { stubConfigService } from '../config/service.stub';
import { ModelNode } from '../model/node';
import { Nothing } from '../model/operation/nothing';
import { ModelService } from '../model/service';
import { BlockRenderNode } from './nodes/block';
import { TextRenderNode } from './nodes/text';
import { RenderService } from './service';

describe('RenderService', () => {
    let root: ModelNode<unknown>;
    let modelService: ModelService;
    let configService: ConfigService;
    let componentService: ComponentService;
    let renderService: RenderService;

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
        modelService = new ModelService(root);
        configService = stubConfigService();
        componentService = new ComponentService(configService);
        renderService = new RenderService(modelService, componentService);
    });

    it('builds render tree', () => {
        const doc = renderService.doc;
        expect(doc.type).toBe('doc');
        expect(doc.id).toBe('doc');
        expect(doc.children.length).toBe(1);
        const paragraph = doc.children[0] as BlockRenderNode;
        expect(paragraph.type).toBe('block');
        expect(paragraph.id).toBe('paragraph');
        expect(paragraph.children.length).toBe(1);
        const text = paragraph.children[0] as TextRenderNode;
        expect(text.type).toBe('text');
        expect(text.id).toBe('text-1');
        expect(text.content).toBe('Hello world!');
    });

    describe('when model tree is updated', () => {
        beforeEach(() => {
            const paragraph = root.children[0] as ModelNode<unknown>;
            paragraph.spliceChildren(12, 0, ' How are you?'.split(''));
            // Apply a no-op operation to trigger a render tree update
            modelService.applyOperation(new Nothing());
        });

        it('updates render tree', () => {
            const doc = renderService.doc;
            expect(doc.type).toBe('doc');
            expect(doc.id).toBe('doc');
            expect(doc.children.length).toBe(1);
            const paragraph = doc.children[0] as BlockRenderNode;
            expect(paragraph.type).toBe('block');
            expect(paragraph.id).toBe('paragraph');
            expect(paragraph.children.length).toBe(1);
            const text = paragraph.children[0] as TextRenderNode;
            expect(text.type).toBe('text');
            expect(text.id).toBe('text-1');
            expect(text.content).toBe('Hello world! How are you?');
        });
    });
});
