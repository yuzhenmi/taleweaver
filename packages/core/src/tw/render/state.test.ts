import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ModelServiceStub } from '../model/service.stub';
import { RenderState } from './state';

describe('ModelState', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let modelService: ModelServiceStub;
    let renderState: RenderState;
    let modelDoc: ModelDoc;
    let modelParagraph: ModelParagraph;
    let modelText1: ModelText;
    let modelText2: ModelText;

    beforeEach(() => {
        configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        modelDoc = new ModelDoc('doc', 'doc', {});
        modelParagraph = new ModelParagraph('paragraph', '1', {});
        modelDoc.setChildren([modelParagraph]);
        modelText1 = new ModelText('text', '2', 'Hello ', {});
        modelText2 = new ModelText('text', '3', 'world', { weight: 700 });
        modelParagraph.setChildren([modelText1, modelText2]);
        modelService = new ModelServiceStub(modelDoc);
        renderState = new RenderState(componentService, modelService);
    });

    it('initializes render tree from model state', () => {
        const doc = renderState.doc;
        expect(doc.componentId).toEqual('doc');
        expect(doc.partId).toEqual('doc');
        expect(doc.modelId).toEqual('doc');
        expect(doc.children).toHaveLength(1);
        const paragraph = doc.firstChild!;
        expect(paragraph.componentId).toEqual('paragraph');
        expect(paragraph.partId).toEqual('paragraph');
        expect(paragraph.modelId).toEqual('1');
        expect(paragraph.children).toHaveLength(3);
        const text1 = paragraph.firstChild!;
        expect(text1.componentId).toEqual('text');
        expect(text1.partId).toEqual('text');
        expect(text1.modelId).toEqual('2');
        expect(text1.text).toEqual('Hello ');
        const text2 = text1.nextSibling!;
        expect(text2.componentId).toEqual('text');
        expect(text2.partId).toEqual('text');
        expect(text2.modelId).toEqual('3');
        expect(text2.text).toEqual('world');
    });

    describe('when model state did update', () => {
        it('updates render tree', () => {
            modelParagraph.setChildren([modelText1]);
            modelService.emitDidTransformModelStateEvent({ node: modelParagraph });
            const doc = renderState.doc;
            expect(doc.children).toHaveLength(1);
            const paragraph = doc.firstChild!;
            expect(paragraph.children).toHaveLength(2);
            const text = paragraph.firstChild!;
            expect(text.text).toEqual('Hello ');
        });
    });
});
