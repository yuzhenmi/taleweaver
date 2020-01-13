import { DocLayoutNode } from '../component/components/doc';
import { LineLayoutNode } from '../component/components/line';
import { PageLayoutNode } from '../component/components/page';
import { ParagraphLayoutNode } from '../component/components/paragraph';
import { DEFAULT_TEXT_STYLE, TextLayoutNode, WordLayoutNode } from '../component/components/text';
import { TextMeasurerStub } from '../component/components/text-measurer.stub';
import { LayoutFlower } from './flower';

describe('LayoutFlower', () => {
    let textMeasurer: TextMeasurerStub;
    let flower: LayoutFlower;

    beforeEach(() => {
        textMeasurer = new TextMeasurerStub();
        flower = new LayoutFlower();
    });

    describe('flow', () => {
        describe('when line overflows', () => {
            let docLayoutNode: DocLayoutNode;

            beforeEach(() => {
                docLayoutNode = new DocLayoutNode('doc', 'doc');
                const pageLayoutNode = new PageLayoutNode('page', 88, 1056, 40, 40, 40, 40);
                docLayoutNode.appendChild(pageLayoutNode);
                const paragraphLayoutNode = new ParagraphLayoutNode('paragraph', '1');
                pageLayoutNode.appendChild(paragraphLayoutNode);
                const lineLayoutNode = new LineLayoutNode('line');
                paragraphLayoutNode.appendChild(lineLayoutNode);
                const textLayoutNode1 = new TextLayoutNode('text', '2', DEFAULT_TEXT_STYLE);
                lineLayoutNode.appendChild(textLayoutNode1);
                const wordLayoutNode1 = new WordLayoutNode(
                    'text',
                    '4',
                    { text: 'Hello ', breakable: true },
                    DEFAULT_TEXT_STYLE,
                    textMeasurer,
                );
                textLayoutNode1.appendChild(wordLayoutNode1);
                const textLayoutNode2 = new TextLayoutNode('text', '3', DEFAULT_TEXT_STYLE);
                lineLayoutNode.appendChild(textLayoutNode2);
                const wordLayoutNode2 = new WordLayoutNode(
                    'text',
                    '5',
                    { text: 'world!', breakable: false },
                    DEFAULT_TEXT_STYLE,
                    textMeasurer,
                );
                textLayoutNode2.appendChild(wordLayoutNode2);
            });

            it('breaks up line', () => {
                flower.flow(docLayoutNode);
                const lineNodes = docLayoutNode
                    .getFirstChild()!
                    .getFirstChild()!
                    .getChildren();
                expect(lineNodes).toHaveLength(2);
                const lineNode1 = lineNodes[0];
                expect(lineNode1.getChildren()).toHaveLength(1);
                const inlineNode1 = lineNode1.getFirstChild()!;
                expect(inlineNode1.getChildren()).toHaveLength(1);
                const atomicNode1 = inlineNode1.getFirstChild()! as WordLayoutNode;
                expect(atomicNode1.getWord().text).toEqual('Hello ');
                expect(atomicNode1.getWord().breakable).toEqual(true);
                const lineNode2 = lineNodes[1];
                expect(lineNode2.getChildren()).toHaveLength(1);
                const inlineNode2 = lineNode2.getFirstChild()!;
                expect(inlineNode2.getChildren()).toHaveLength(1);
                const atomicNode2 = inlineNode2.getFirstChild()! as WordLayoutNode;
                expect(atomicNode2.getWord().text).toEqual('world!');
                expect(atomicNode2.getWord().breakable).toEqual(false);
            });

            it('marks lines as flowed', () => {
                flower.flow(docLayoutNode);
                const lineNodes = docLayoutNode
                    .getFirstChild()!
                    .getFirstChild()!
                    .getChildren();
                expect(lineNodes[0].isFlowed()).toEqual(true);
                expect(lineNodes[1].isFlowed()).toEqual(true);
            });
        });

        describe('when page overflows', () => {
            let docLayoutNode: DocLayoutNode;

            beforeEach(() => {
                docLayoutNode = new DocLayoutNode('doc', 'doc');
                const pageLayoutNode = new PageLayoutNode('page', 88, 108, 40, 40, 40, 40);
                docLayoutNode.appendChild(pageLayoutNode);
                const paragraphLayoutNode = new ParagraphLayoutNode('paragraph', '1');
                pageLayoutNode.appendChild(paragraphLayoutNode);
                const lineLayoutNode = new LineLayoutNode('line');
                paragraphLayoutNode.appendChild(lineLayoutNode);
                const textLayoutNode1 = new TextLayoutNode('text', '2', DEFAULT_TEXT_STYLE);
                lineLayoutNode.appendChild(textLayoutNode1);
                const wordLayoutNode1 = new WordLayoutNode(
                    'text',
                    '4',
                    { text: 'Hello ', breakable: true },
                    DEFAULT_TEXT_STYLE,
                    textMeasurer,
                );
                textLayoutNode1.appendChild(wordLayoutNode1);
                const textLayoutNode2 = new TextLayoutNode('text', '3', DEFAULT_TEXT_STYLE);
                lineLayoutNode.appendChild(textLayoutNode2);
                const wordLayoutNode2 = new WordLayoutNode(
                    'text',
                    '5',
                    { text: 'world!', breakable: false },
                    DEFAULT_TEXT_STYLE,
                    textMeasurer,
                );
                textLayoutNode2.appendChild(wordLayoutNode2);
            });

            it('breaks up page', () => {
                flower.flow(docLayoutNode);
                expect(docLayoutNode.getChildren()).toHaveLength(2);
                const pageNode1 = docLayoutNode.getFirstChild()!;
                expect(pageNode1.getChildren()).toHaveLength(1);
                const blockNode1 = pageNode1.getFirstChild()!;
                expect(blockNode1.getChildren()).toHaveLength(1);
                const lineNode1 = blockNode1.getFirstChild()!;
                expect(lineNode1.getChildren()).toHaveLength(1);
                const inlineNode1 = lineNode1.getFirstChild()!;
                expect(inlineNode1.getChildren()).toHaveLength(1);
                const atomicNode1 = inlineNode1.getFirstChild()! as WordLayoutNode;
                expect(atomicNode1.getWord().text).toEqual('Hello ');
                expect(atomicNode1.getWord().breakable).toEqual(true);
                const pageNode2 = docLayoutNode.getLastChild()!;
                expect(pageNode2.getChildren()).toHaveLength(1);
                const blockNode2 = pageNode2.getFirstChild()!;
                expect(blockNode2.getChildren()).toHaveLength(1);
                const lineNode2 = blockNode2.getFirstChild()!;
                expect(lineNode2.getChildren()).toHaveLength(1);
                const inlineNode2 = lineNode2.getFirstChild()!;
                expect(inlineNode2.getChildren()).toHaveLength(1);
                const atomicNode2 = inlineNode2.getFirstChild()! as WordLayoutNode;
                expect(atomicNode2.getWord().text).toEqual('world!');
                expect(atomicNode2.getWord().breakable).toEqual(false);
            });

            it('marks pages as flowed', () => {
                flower.flow(docLayoutNode);
                const pageNodes = docLayoutNode.getChildren();
                expect(pageNodes[0].isFlowed()).toEqual(true);
                expect(pageNodes[1].isFlowed()).toEqual(true);
            });
        });
    });
});
