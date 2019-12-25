import { DocComponent, DocModelNode } from '../component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from '../component/components/paragraph';
import { TextComponent, TextModelNode } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigService } from '../config/service';
import { IEventListener } from '../event/listener';
import { TextMeasurerStub } from '../layout/text-measurer.stub';
import { IDocModelNode } from '../model/doc-node';
import { IModelPosition } from '../model/node';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
import { RenderService } from './service';

class MockModelService implements IModelService {
    constructor(protected docNode: IDocModelNode) {}

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {}

    getDocNode(): IDocModelNode {
        return this.docNode;
    }

    toHTML(from: number, to: number): string {
        throw new Error('Not implemented.');
    }

    resolvePosition(offset: number): IModelPosition {
        throw new Error('Not implemented.');
    }
}

describe('RenderService', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let modelService: MockModelService;
    let service: RenderService;

    beforeEach(() => {
        textMeasurer = new TextMeasurerStub();
        const docComponent = new DocComponent('doc');
        const paragraphComponent = new ParagraphComponent('paragraph');
        const textComponent = new TextComponent('text', textMeasurer);
        configService = new ConfigService(
            {
                commands: {},
                components: {
                    doc: docComponent,
                    paragraph: paragraphComponent,
                    text: textComponent,
                },
            },
            {},
        );
        componentService = new ComponentService(configService);
        const docModelNode = new DocModelNode('doc', 'doc', {});
        const paragraphModelNode = new ParagraphModelNode('paragraph', '1', {});
        docModelNode.appendChild(paragraphModelNode);
        const textModelNode1 = new TextModelNode('text', '2', {});
        textModelNode1.setContent('Hello ');
        const textModelNode2 = new TextModelNode('text', '3', { weight: 700 });
        textModelNode2.setContent('world');
        paragraphModelNode.appendChild(textModelNode1);
        paragraphModelNode.appendChild(textModelNode2);
        modelService = new MockModelService(docModelNode);
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
                            size: 14,
                            font: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                        },
                    ],
                    word: [
                        {
                            weight: 400,
                            size: 14,
                            font: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                        },
                    ],
                },
            });
            const styles2 = service.getStylesBetween(6, 7);
            expect(styles2).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: {
                    text: [
                        {
                            weight: 700,
                            size: 14,
                            font: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                        },
                    ],
                    word: [
                        {
                            weight: 700,
                            size: 14,
                            font: 'sans-serif',
                            letterSpacing: 0,
                            underline: false,
                            italic: false,
                            strikethrough: false,
                        },
                    ],
                },
            });
        });
    });
});
