import { DocComponent, DocLayoutNode, DocRenderNode } from 'tw/component/components/doc';
import {
    ParagraphComponent,
    ParagraphLayoutNode,
    ParagraphLineBreakLayoutNode,
    ParagraphRenderNode,
} from 'tw/component/components/paragraph';
import { TextComponent, TextLayoutNode, TextRenderNode, WordRenderNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { LayoutTreeBuilder } from './tree-builder';

describe('LayoutTreeBuilder', () => {
    let configService: ConfigService;
    let componentService: ComponentService;
    let docRenderNode: DocRenderNode;
    let treeBuilder: LayoutTreeBuilder;

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
        docRenderNode = new DocRenderNode('doc', 'doc', {});
        const paragraphRenderNode = new ParagraphRenderNode('paragraph', '1', {});
        docRenderNode.setChildren([paragraphRenderNode]);
        const textRenderNode1 = new TextRenderNode('text', '2', { bold: false });
        const wordRenderNode1 = new WordRenderNode('text', '4', {}, { text: 'Hello ', breakable: true });
        textRenderNode1.setChildren([wordRenderNode1]);
        const textRenderNode2 = new TextRenderNode('text', '3', { bold: true });
        const wordRenderNode2 = new WordRenderNode('text', '5', {}, { text: 'world', breakable: false });
        textRenderNode2.setChildren([wordRenderNode2]);
        paragraphRenderNode.setChildren([textRenderNode1, textRenderNode2]);
        treeBuilder = new LayoutTreeBuilder(componentService);
    });

    describe('buildTree', () => {
        it('builds layout tree from render tree without flow', () => {
            const doc = treeBuilder.buildTree(docRenderNode) as DocLayoutNode;
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getChildren()).toHaveLength(1);
            const page = doc.getFirstChild()!;
            expect(page.getComponentId()).toEqual('');
            expect(page.getPartId()).toEqual('page');
            expect(page.getChildren()).toHaveLength(1);
            const paragaph = page.getFirstChild() as ParagraphLayoutNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toEqual('paragraph');
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getChildren()).toHaveLength(1);
            const line = paragaph.getFirstChild()!;
            expect(line.getComponentId()).toEqual('');
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
