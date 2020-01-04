import { DocComponent, DocLayoutNode, DocRenderNode } from '../component/components/doc';
import {
    ParagraphComponent,
    ParagraphLayoutNode,
    ParagraphLineBreakLayoutNode,
    ParagraphRenderNode,
} from '../component/components/paragraph';
import { TextComponent, TextLayoutNode, TextRenderNode, WordRenderNode } from '../component/components/text';
import { DEFAULT_TEXT_STYLE, TextMeasurerStub } from '../component/components/text-measurer.stub';
import { ComponentService } from '../component/service';
import { ConfigService } from '../config/service';
import { LayoutTreeBuilder } from './tree-builder';

describe('LayoutTreeBuilder', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let docRenderNode: DocRenderNode;
    let treeBuilder: LayoutTreeBuilder;

    beforeEach(() => {
        textMeasurer = new TextMeasurerStub();
        const docComponent = new DocComponent('doc');
        const paragraphComponent = new ParagraphComponent('paragraph');
        const textComponent = new TextComponent('text', textMeasurer);
        configService = new ConfigService(
            {
                commands: {},
                keyBindings: {
                    common: {},
                },
                components: {
                    doc: docComponent,
                    paragraph: paragraphComponent,
                    text: textComponent,
                },
                page: {
                    width: 816,
                    height: 1056,
                    paddingTop: 40,
                    paddingBottom: 40,
                    paddingLeft: 40,
                    paddingRight: 40,
                },
            },
            {},
        );
        componentService = new ComponentService(configService);
        docRenderNode = new DocRenderNode('doc', 'doc', {});
        const paragraphRenderNode = new ParagraphRenderNode('paragraph', '1', {});
        docRenderNode.appendChild(paragraphRenderNode);
        const textRenderNode1 = new TextRenderNode('text', '2', DEFAULT_TEXT_STYLE);
        const wordRenderNode1 = new WordRenderNode('text', '4', DEFAULT_TEXT_STYLE, {
            text: 'Hello ',
            breakable: true,
        });
        textRenderNode1.appendChild(wordRenderNode1);
        const textRenderNode2 = new TextRenderNode('text', '3', DEFAULT_TEXT_STYLE);
        const wordRenderNode2 = new WordRenderNode('text', '5', DEFAULT_TEXT_STYLE, {
            text: 'world',
            breakable: false,
        });
        textRenderNode2.appendChild(wordRenderNode2);
        paragraphRenderNode.appendChild(textRenderNode1);
        paragraphRenderNode.appendChild(textRenderNode2);
        treeBuilder = new LayoutTreeBuilder(componentService);
    });

    describe('buildTree', () => {
        it('builds layout tree from render tree without flow', () => {
            const doc = treeBuilder.buildTree(docRenderNode) as DocLayoutNode;
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getChildren()).toHaveLength(1);
            const page = doc.getFirstChild()!;
            expect(page.getComponentId()).toEqual('page');
            expect(page.getPartId()).toEqual('page');
            expect(page.getChildren()).toHaveLength(1);
            const paragaph = page.getFirstChild() as ParagraphLayoutNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toEqual('paragraph');
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getChildren()).toHaveLength(1);
            const line = paragaph.getFirstChild()!;
            expect(line.getComponentId()).toEqual('line');
            expect(line.getPartId()).toEqual('line');
            expect(line.getChildren()).toHaveLength(3);
            const text1 = line.getFirstChild() as TextLayoutNode;
            expect(text1.getComponentId()).toEqual('text');
            expect(text1.getPartId()).toEqual('text');
            expect(text1.getId()).toEqual('2');
            const text2 = text1.getNextSibling() as TextLayoutNode;
            expect(text2.getComponentId()).toEqual('text');
            expect(text2.getPartId()).toEqual('text');
            expect(text2.getId()).toEqual('3');
            const lineBreak = text2.getNextSibling() as ParagraphLineBreakLayoutNode;
            expect(lineBreak.getComponentId()).toEqual('paragraph');
            expect(lineBreak.getPartId()).toEqual('line-break');
            expect(lineBreak.getId()).toEqual('1.line-break');
        });
    });
});
