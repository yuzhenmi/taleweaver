import { ModelText } from '../component/components/text';
import { ComponentService } from '../component/service';
import { ConfigServiceStub } from '../config/service.stub';
import { CLOSE_TOKEN } from '../state/token';
import { TokenParser } from './parser';

describe('TokenParser', () => {
    let configService: ConfigServiceStub;
    let componentService: ComponentService;
    let parser: TokenParser;

    beforeEach(() => {
        configService = new ConfigServiceStub();
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
            expect(doc.componentId).toEqual('doc');
            expect(doc.partId).toEqual('doc');
            expect(doc.id).toEqual('doc');
            expect(doc.attributes).toEqual({});
            expect(doc.children).toHaveLength(1);
            const paragraph = doc.firstChild!;
            expect(paragraph.componentId).toEqual('paragraph');
            expect(paragraph.partId).toEqual('paragraph');
            expect(paragraph.id).toEqual('1');
            expect(paragraph.attributes).toEqual({});
            expect(paragraph.children).toHaveLength(2);
            const text1 = paragraph.firstChild as ModelText;
            expect(text1.componentId).toEqual('text');
            expect(text1.partId).toEqual('text');
            expect(text1.id).toEqual('2');
            expect(text1.attributes).toEqual({});
            expect(text1.text).toEqual('Hello');
            const text2 = text1.nextSibling!;
            expect(text2.componentId).toEqual('text');
            expect(text2.partId).toEqual('text');
            expect(text2.id).toEqual('3');
            expect(text2.attributes).toEqual({ bold: true });
            expect(text2.text).toEqual('world');
        });
    });
});
