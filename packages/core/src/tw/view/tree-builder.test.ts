import { JSDOM } from 'jsdom';
import { DocComponent, DocLayoutNode } from '../component/components/doc';
import { LineLayoutNode, LineViewNode } from '../component/components/line';
import { PageLayoutNode, PageViewNode } from '../component/components/page';
import { ParagraphComponent, ParagraphLayoutNode, ParagraphViewNode } from '../component/components/paragraph';
import {
    DEFAULT_TEXT_STYLE,
    TextComponent,
    TextLayoutNode,
    TextViewNode,
    WordLayoutNode,
} from '../component/components/text';
import { TextMeasurerStub } from '../component/components/text-measurer.stub';
import { ComponentService } from '../component/service';
import { buildStubConfig } from '../config/config.stub';
import { ConfigService } from '../config/service';
import { ViewTreeBuilder } from './tree-builder';

describe('ViewTreeBuilder', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let docLayoutNode: DocLayoutNode;
    let treeBuilder: ViewTreeBuilder;

    beforeEach(() => {
        const dom = new JSDOM();
        // @ts-ignore
        global.document = dom.window.document;
    });

    beforeEach(() => {
        const config = buildStubConfig();
        textMeasurer = new TextMeasurerStub();
        config.components.doc = new DocComponent('doc');
        config.components.paragraph = new ParagraphComponent('paragraph');
        config.components.text = new TextComponent('text', textMeasurer);
        configService = new ConfigService(config, {});
        componentService = new ComponentService(configService);
        docLayoutNode = new DocLayoutNode('doc', 'doc');
        const pageLayoutNode = new PageLayoutNode('page', 816, 1056, 40, 40, 40, 40);
        docLayoutNode.appendChild(pageLayoutNode);
        const paragraphLayoutNode = new ParagraphLayoutNode('paragraph', '1');
        pageLayoutNode.appendChild(paragraphLayoutNode);
        const lineLayoutNode = new LineLayoutNode('line');
        paragraphLayoutNode.appendChild(lineLayoutNode);
        const textLayoutNode = new TextLayoutNode('text', '2', DEFAULT_TEXT_STYLE);
        lineLayoutNode.appendChild(textLayoutNode);
        const wordLayoutNode1 = new WordLayoutNode(
            'text',
            '3',
            {
                text: 'Hello ',
                breakable: true,
            },
            DEFAULT_TEXT_STYLE,
            textMeasurer,
        );
        textLayoutNode.appendChild(wordLayoutNode1);
        const wordLayoutNode2 = new WordLayoutNode(
            'text',
            '3',
            {
                text: 'world!',
                breakable: false,
            },
            DEFAULT_TEXT_STYLE,
            textMeasurer,
        );
        textLayoutNode.appendChild(wordLayoutNode2);
        treeBuilder = new ViewTreeBuilder('test', componentService);
    });

    describe('buildTree', () => {
        it('builds view tree from layout tree', () => {
            const doc = treeBuilder.buildTree(docLayoutNode);
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getChildren()).toHaveLength(1);
            const page = doc.getFirstChild() as PageViewNode;
            expect(page.getChildren()).toHaveLength(1);
            const paragraph = page.getFirstChild() as ParagraphViewNode;
            expect(paragraph.getComponentId()).toEqual('paragraph');
            expect(paragraph.getId()).toEqual('1');
            expect(paragraph.getChildren()).toHaveLength(1);
            const line = paragraph.getFirstChild() as LineViewNode;
            expect(line.getChildren()).toHaveLength(1);
            const text = line.getFirstChild() as TextViewNode;
            expect(text.getComponentId()).toEqual('text');
            expect(text.getId()).toEqual('2');
            const textDOM = text.getDOMContentContainer();
            expect((textDOM.firstChild as HTMLSpanElement).innerText).toEqual('Hello world!');
        });
    });
});
