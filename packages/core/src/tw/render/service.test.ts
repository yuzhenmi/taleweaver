import { DocComponent, DocModelNode } from 'tw/component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { IEventListener } from 'tw/event/listener';
import { IDocModelNode } from 'tw/model/doc-node';
import { IModelPosition } from 'tw/model/node';
import { IModelService } from 'tw/model/service';
import { IDidUpdateModelStateEvent } from 'tw/model/state';
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
    let configService: ConfigService;
    let componentService: ComponentService;
    let modelService: MockModelService;
    let service: RenderService;

    beforeEach(() => {
        const docComponent = new DocComponent('doc');
        const paragraphComponent = new ParagraphComponent('paragraph');
        const textComponent = new TextComponent('text');
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
        const textModelNode2 = new TextModelNode('text', '3', { bold: true });
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
                text: { text: [{ bold: false }], word: [{}] },
            });
            const styles2 = service.getStylesBetween(6, 7);
            expect(styles2).toEqual({
                doc: { doc: [{}] },
                paragraph: { paragraph: [{}] },
                text: { text: [{ bold: true }], word: [{}] },
            });
        });
    });
});
