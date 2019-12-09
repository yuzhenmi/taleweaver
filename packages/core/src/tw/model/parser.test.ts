import { DocComponent } from 'tw/component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { TextMeasurerStub } from 'tw/layout/text-measurer.stub';
import { TokenParser } from 'tw/model/parser';
import { CLOSE_TOKEN } from 'tw/state/token';

describe('TokenParser', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let parser: TokenParser;

    beforeEach(() => {
        textMeasurer = new TextMeasurerStub();
        configService = new ConfigService(
            {
                commands: {},
                components: {
                    doc: new DocComponent('doc'),
                    paragraph: new ParagraphComponent('paragraph'),
                    text: new TextComponent('text', textMeasurer),
                },
            },
            {},
        );
        componentService = new ComponentService(configService);
        parser = new TokenParser(componentService);
    });

    describe('parse', () => {
        it('parses tokens', () => {
            const tokens = [
                { componentId: 'doc', id: 'doc', attributes: {} },
                { componentId: 'paragraph', id: '1', attributes: {} },
                { componentId: 'text', id: '2', attributes: {} },
                'H',
                'e',
                'l',
                'l',
                'o',
                CLOSE_TOKEN,
                { componentId: 'text', id: '3', attributes: { bold: true } },
                'w',
                'o',
                'r',
                'l',
                'd',
                CLOSE_TOKEN,
                CLOSE_TOKEN,
                CLOSE_TOKEN,
            ];
            const doc = parser.parse(tokens);
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getPartId()).toEqual('doc');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getAttributes()).toEqual({});
            expect(doc.getChildren()).toHaveLength(1);
            const paragaph = doc.getFirstChild() as ParagraphModelNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toEqual('paragraph');
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getAttributes()).toEqual({});
            expect(paragaph.getChildren()).toHaveLength(2);
            const text1 = paragaph.getFirstChild() as TextModelNode;
            expect(text1.getComponentId()).toEqual('text');
            expect(text1.getPartId()).toEqual('text');
            expect(text1.getId()).toEqual('2');
            expect(text1.getAttributes()).toEqual({});
            expect(text1.getContent()).toEqual('Hello');
            const text2 = text1.getNextSibling() as TextModelNode;
            expect(text2.getComponentId()).toEqual('text');
            expect(text2.getPartId()).toEqual('text');
            expect(text2.getId()).toEqual('3');
            expect(text2.getAttributes()).toEqual({ bold: true });
            expect(text2.getContent()).toEqual('world');
        });
    });
});
