import { DocComponent, DocModelNode } from 'tw/component/components/doc';
import { ParagraphComponent, ParagraphModelNode, ParagraphRenderNode } from 'tw/component/components/paragraph';
import { TextComponent, TextModelNode, TextRenderNode, WordRenderNode } from 'tw/component/components/text';
import { ComponentService } from 'tw/component/service';
import { ConfigService } from 'tw/config/service';
import { RenderTreeBuilder } from 'tw/render/tree-builder';

describe('RenderTreeBuilder', () => {
    let configService: ConfigService;
    let componentService: ComponentService;
    let docModelNode: DocModelNode;
    let treeBuilder: RenderTreeBuilder;

    beforeEach(() => {
        const docComponent = new DocComponent('doc');
        const paragraphComponent = new ParagraphComponent('paragraph');
        const textComponent = new TextComponent('text');
        configService = new ConfigService(
            {
                commands: {},
                components: {
                    doc: new DocComponent('doc'),
                    paragraph: new ParagraphComponent('paragraph'),
                    text: new TextComponent('text'),
                },
            },
            {},
        );
        componentService = new ComponentService(configService);
        docModelNode = new DocModelNode(docComponent, 'doc', {});
        const paragraphModelNode = new ParagraphModelNode(paragraphComponent, '1', {});
        docModelNode.setChildren([paragraphModelNode]);
        const textModelNode1 = new TextModelNode(textComponent, '2', {});
        textModelNode1.setContent('Hello');
        const textModelNode2 = new TextModelNode(textComponent, '3', { bold: true });
        textModelNode2.setContent('world');
        paragraphModelNode.setChildren([textModelNode1, textModelNode2]);
        treeBuilder = new RenderTreeBuilder(componentService);
    });

    describe('buildTree', () => {
        it('builds render tree from model tree', () => {
            const doc = treeBuilder.buildTree(docModelNode);
            expect(doc.getComponentId()).toEqual('doc');
            expect(doc.getPartId()).toBeUndefined();
            expect(doc.getId()).toEqual('doc');
            expect(doc.getChildren()).toHaveLength(1);
            const paragaph = doc.getFirstChild() as ParagraphRenderNode;
            expect(paragaph.getComponentId()).toEqual('paragraph');
            expect(paragaph.getPartId()).toBeUndefined();
            expect(paragaph.getId()).toEqual('1');
            expect(paragaph.getChildren()).toHaveLength(2);
            const text1 = paragaph.getFirstChild() as TextRenderNode;
            expect(text1.getComponentId()).toEqual('text');
            expect(text1.getPartId()).toBeUndefined();
            expect(text1.getId()).toEqual('2');
            expect(text1.getChildren()).toHaveLength(1);
            const word1 = text1.getFirstChild() as WordRenderNode;
            expect(word1.getComponentId()).toEqual('text');
            expect(word1.getPartId()).toBeUndefined();
            expect(word1.getId()).toEqual('2-0');
            expect(word1.getContent()).toEqual('Hello');
            const text2 = text1.getNextSibling() as TextRenderNode;
            expect(text2.getComponentId()).toEqual('text');
            expect(text2.getPartId()).toBeUndefined();
            expect(text2.getId()).toEqual('3');
            const word2 = text2.getFirstChild() as WordRenderNode;
            expect(word2.getComponentId()).toEqual('text');
            expect(word2.getPartId()).toBeUndefined();
            expect(word2.getId()).toEqual('3-0');
            expect(word2.getContent()).toEqual('world');
        });
    });
});
