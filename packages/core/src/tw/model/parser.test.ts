import { DocComponent } from 'tw/component/components/doc';
import { ParagraphComponent, ParagraphModelNode } from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { IConfig, IExternalConfig } from 'tw/config/config';
import { ConfigService } from 'tw/config/service';
import { TokenParser } from 'tw/model/parser';
import { CLOSE_TOKEN } from 'tw/state/token';

describe('TokenParser', () => {
    let parser: TokenParser;

    beforeEach(() => {
        const config: IConfig = {
            commands: {},
            components: {
                doc: new DocComponent('doc'),
                paragraph: new ParagraphComponent('paragraph'),
                text: new TextComponent('text'),
            },
        };
        const externalConfig: IExternalConfig = {};
        const configService = new ConfigService(config, externalConfig);
        const componentService = new ComponentService(configService);
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
            expect(doc.getPartId()).toBeUndefined();
            expect(doc.getId()).toEqual('doc');
            expect(doc.getAttributes()).toEqual({});
            expect(doc.getChildNodes()).toHaveLength(1);
            const paragaph = doc.getFirstChild() as ParagraphModelNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toBeUndefined();
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getAttributes()).toEqual({});
            expect(paragaph.getChildNodes()).toHaveLength(2);
            const text1 = paragaph.getFirstChild() as TextModelNode;
            expect(text1.getComponentId()).toEqual('text');
            expect(text1.getPartId()).toBeUndefined();
            expect(text1.getId()).toEqual('2');
            expect(text1.getAttributes()).toEqual({});
            expect(text1.getContent()).toEqual('Hello');
            const text2 = text1.getNextSibling() as TextModelNode;
            expect(text2.getComponentId()).toEqual('text');
            expect(text2.getPartId()).toBeUndefined();
            expect(text2.getId()).toEqual('3');
            expect(text2.getAttributes()).toEqual({ bold: true });
            expect(text2.getContent()).toEqual('world');
        });
    });
});
