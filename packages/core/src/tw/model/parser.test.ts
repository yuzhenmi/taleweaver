import { ConfigService } from 'tw/config/service';
import { DocElement } from 'tw/element/elements/doc';
import { ParagraphElement, ParagraphModelNode } from 'tw/element/elements/paragraph';
import { TextElement, TextModelNode } from 'tw/element/elements/text';
import { ElementService } from 'tw/element/service';
import TokenParser from 'tw/model/parser';
import { CLOSE_TOKEN } from 'tw/state/token';

describe('TokenParser', () => {
    let parser: TokenParser;

    beforeEach(() => {
        const config = {
            commands: {},
            elements: {
                doc: DocElement,
                paragraph: ParagraphElement,
                text: TextElement,
            },
        };
        const externalConfig = {};
        const configService = new ConfigService(config, externalConfig);
        const elementService = new ElementService(configService);
        parser = new TokenParser(elementService);
    });

    describe('parse', () => {
        it('parses tokens', () => {
            const tokens = [
                { elementId: 'doc', type: '', id: 'doc', attributes: {} },
                { elementId: 'paragraph', type: '', id: '1', attributes: {} },
                { elementId: 'text', type: '', id: '2', attributes: {} },
                'H',
                'e',
                'l',
                'l',
                'o',
                CLOSE_TOKEN,
                { elementId: 'text', type: '', id: '3', attributes: { bold: true } },
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
            expect(doc.getElementId()).toEqual('doc');
            expect(doc.getType()).toEqual('');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getAttributes()).toEqual({});
            expect(doc.getChildNodes()).toHaveLength(1);
            const paragaph = doc.getFirstChild() as ParagraphModelNode;
            expect(paragaph.getElementId()).toEqual('paragraph');
            expect(paragaph.getType()).toEqual('');
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getAttributes()).toEqual({});
            expect(paragaph.getChildNodes()).toHaveLength(2);
            const text1 = paragaph.getFirstChild() as TextModelNode;
            expect(text1.getElementId()).toEqual('text');
            expect(text1.getType()).toEqual('');
            expect(text1.getId()).toEqual('2');
            expect(text1.getAttributes()).toEqual({});
            expect(text1.getContent()).toEqual('Hello');
            const text2 = text1.getNextSibling() as TextModelNode;
            expect(text2.getElementId()).toEqual('text');
            expect(text2.getType()).toEqual('');
            expect(text2.getId()).toEqual('3');
            expect(text2.getAttributes()).toEqual({ bold: true });
            expect(text2.getContent()).toEqual('world');
        });
    });
});
