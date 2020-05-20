import { ModelDoc } from '../component/components/doc';
import { ModelParagraph } from '../component/components/paragraph';
import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { ModelServiceStub } from '../model/service.stub';
import { RenderService } from './service';

describe('RenderService', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let modelService: ModelServiceStub;
    let service: RenderService;

    beforeEach(() => {
        configService = new ConfigServiceStub();
        componentService = new ComponentService(configService);
        const modelDoc = new ModelDoc('doc', 'doc', {});
        const modelParagraph = new ModelParagraph('paragraph', '1', {});
        modelDoc.setChildren([modelParagraph]);
        const modelText1 = new ModelText('text', '2', 'Hello ', {});
        const modelText2 = new ModelText('text', '3', 'world', { weight: 700 });
        modelParagraph.setChildren([modelText1, modelText2]);
        modelService = new ModelServiceStub(modelDoc);
        service = new RenderService(componentService, modelService);
    });

    describe('getStylesBetween', () => {
        it('returns styles of all render nodes covering the range', () => {
            const styles1 = service.getStylesBetween(1, 2);
            expect(styles1).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: {
                    text: [
                        {
                            weight: 400,
                            size: 16,
                            family: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                            color: 'black',
                        },
                    ],
                },
            });
            const styles2 = service.getStylesBetween(7, 8);
            expect(styles2).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: {
                    text: [
                        {
                            weight: 700,
                            size: 16,
                            family: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                            color: 'black',
                        },
                    ],
                },
            });
        });
    });
});
