import { DocComponent, DocModelNode } from 'tw/component/components/doc';
import {
    ParagraphComponent,
    ParagraphLineBreakRenderNode,
    ParagraphModelNode,
    ParagraphRenderNode,
} from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode, TextRenderNode, WordRenderNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { TextMeasurerStub } from 'tw/layout/text-measurer.stub';
import { RenderTreeBuilder } from 'tw/render/tree-builder';

describe('RenderTreeBuilder', () => {
    let textMeasurer: TextMeasurerStub;
    let configService: ConfigService;
    let componentService: ComponentService;
    let docModelNode: DocModelNode;
    let treeBuilder: RenderTreeBuilder;

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
        docModelNode = new DocModelNode('doc', 'doc', {});
        const paragraphModelNode = new ParagraphModelNode('paragraph', '1', {});
        docModelNode.appendChild(paragraphModelNode);
        const textModelNode1 = new TextModelNode('text', '2', {});
        textModelNode1.setContent('Hello ');
        const textModelNode2 = new TextModelNode('text', '3', { bold: true });
        textModelNode2.setContent('world');
        paragraphModelNode.appendChild(textModelNode1);
        paragraphModelNode.appendChild(textModelNode2);
        treeBuilder = new RenderTreeBuilder(componentService);
    });

    describe('buildTree', () => {
        it('builds render tree from model tree', () => {
            const doc = treeBuilder.buildTree(docModelNode);
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getId()).toEqual('doc');
            expect(doc.getChildren()).toHaveLength(1);
            const paragaph = doc.getFirstChild() as ParagraphRenderNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toEqual('paragraph');
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getChildren()).toHaveLength(3);
            const text1 = paragaph.getFirstChild() as TextRenderNode;
            expect(text1.getComponentId()).toEqual('text');
            expect(text1.getPartId()).toEqual('text');
            expect(text1.getId()).toEqual('2');
            expect(text1.getChildren()).toHaveLength(1);
            const word1 = text1.getFirstChild() as WordRenderNode;
            expect(word1.getComponentId()).toEqual('text');
            expect(word1.getPartId()).toEqual('word');
            expect(word1.getId()).toEqual('2-0');
            expect(word1.getWord().text).toEqual('Hello ');
            expect(word1.getWord().breakable).toEqual(true);
            const text2 = text1.getNextSibling() as TextRenderNode;
            expect(text2.getComponentId()).toEqual('text');
            expect(text2.getPartId()).toEqual('text');
            expect(text2.getId()).toEqual('3');
            const word2 = text2.getFirstChild() as WordRenderNode;
            expect(word2.getComponentId()).toEqual('text');
            expect(word2.getPartId()).toEqual('word');
            expect(word2.getId()).toEqual('3-0');
            expect(word2.getWord().text).toEqual('world');
            expect(word2.getWord().breakable).toEqual(false);
            const lineBreak = text2.getNextSibling();
            expect(lineBreak).toBeInstanceOf(ParagraphLineBreakRenderNode);
        });
    });
});
