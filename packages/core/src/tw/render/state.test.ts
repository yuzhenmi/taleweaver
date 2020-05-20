import { DocComponent, ModelDoc } from '../component/components/doc';
import { ModelParagraph, ParagraphComponent } from '../component/components/paragraph';
import { ModelText, TextComponent } from '../component/components/text';
import { ComponentService } from '../component/service';
import { buildStubConfig } from '../config/config.stub';
import { ConfigService } from '../config/service';
import { ModelServiceStub } from '../model/service.stub';
import { TextServiceStub } from '../text/service.stub';
import { RenderState } from './state';

describe('ModelState', () => {
    let configService: ConfigService;
    let textService: TextServiceStub;
    let docComponent: DocComponent;
    let paragraphComponent: ParagraphComponent;
    let textComponent: TextComponent;
    let componentService: ComponentService;
    let modelService: ModelServiceStub;
    let renderState: RenderState;
    let modelDoc: ModelDoc;
    let modelParagraph: ModelParagraph;
    let modelText1: ModelText;
    let modelText2: ModelText;

    beforeEach(() => {
        const config = buildStubConfig();
        configService = new ConfigService(config, {});
        textService = new TextServiceStub();
        docComponent = new DocComponent('doc', configService);
        paragraphComponent = new ParagraphComponent('paragraph');
        textComponent = new TextComponent('text', textService);
        config.components.doc = docComponent;
        config.components.paragraph = paragraphComponent;
        config.components.text = textComponent;
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
            modelService.emitDidUpdateModelStateEvent({ node: modelParagraph });
            const doc = renderState.doc;
            expect(doc.children).toHaveLength(1);
            const paragraph = doc.firstChild!;
            expect(paragraph.children).toHaveLength(2);
            const text = paragraph.firstChild!;
            expect(text.text).toEqual('Hello ');
        });
    });
});
