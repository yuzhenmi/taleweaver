import { JSDOM } from 'jsdom';
import { DocComponent, DocLayoutNode } from 'tw/component/components/doc';
import { LineLayoutNode, LineViewNode } from 'tw/component/components/line';
import { PageLayoutNode, PageViewNode } from 'tw/component/components/page';
import { ParagraphComponent, ParagraphLayoutNode, ParagraphViewNode } from 'tw/component/components/paragraph';
import { TextComponent, TextLayoutNode, TextViewNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { TextMeasurerStub } from 'tw/layout/text-measurer.stub';
import { ViewTreeBuilder } from 'tw/view/tree-builder';

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
        docLayoutNode = new DocLayoutNode('doc', 'doc');
        const pageLayoutNode = new PageLayoutNode('$page', 816, 1056, 40, 40, 40, 40);
        docLayoutNode.appendChild(pageLayoutNode);
        const paragraphLayoutNode = new ParagraphLayoutNode('paragraph', '1');
        pageLayoutNode.appendChild(paragraphLayoutNode);
        const lineLayoutNode = new LineLayoutNode('$line');
        paragraphLayoutNode.appendChild(lineLayoutNode);
        const textLayoutNode = new TextLayoutNode('text', '2');
        lineLayoutNode.appendChild(textLayoutNode);
        treeBuilder = new ViewTreeBuilder(componentService);
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
        });
    });
});
