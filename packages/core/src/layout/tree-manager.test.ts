import { BlockRenderNode, DocRenderNode, TextRenderNode } from '../render/node';
import { TextService } from '../text/service';
import { TextServiceStub } from '../text/service.stub';
import { IDocLayoutNode } from './doc-node';
import { LayoutTreeManager } from './tree-manager';

function getContentFromDoc(doc: IDocLayoutNode) {
    return doc.children.map((page) =>
        page.children.map((block) =>
            block.children.map((line) =>
                line.children.map((textOrInline) => {
                    switch (textOrInline.type) {
                        case 'text':
                            return textOrInline.children.map((word) => word.content);
                        default:
                            return null;
                    }
                }),
            ),
        ),
    );
}

describe('LayoutTreeManager', () => {
    let textService: TextService;
    let treeManager: LayoutTreeManager;

    beforeEach(() => {
        textService = new TextServiceStub();
        treeManager = new LayoutTreeManager(textService);
    });

    describe('syncWithRenderTree', () => {
        let renderDoc: DocRenderNode;
        let renderBlock: BlockRenderNode;
        let renderText: TextRenderNode;
        let doc: IDocLayoutNode;

        beforeEach(() => {
            renderDoc = new DocRenderNode('doc');
            renderDoc.setStyle({
                pageWidth: 800,
                pageHeight: 1120,
                pagePaddingTop: 64,
                pagePaddingBottom: 64,
                pagePaddingLeft: 64,
                pagePaddingRight: 64,
            });
            renderBlock = new BlockRenderNode('block');
            renderBlock.setStyle({
                paddingTop: 16,
                paddingBottom: 16,
                paddingLeft: 0,
                paddingRight: 0,
                lineHeight: 1,
            });
            renderText = new TextRenderNode();
            renderText.setStyle({
                weight: 400,
                size: 14,
                family: 'sans-serif',
                letterSpacing: 0,
                underline: false,
                italic: false,
                strikethrough: false,
                color: 'black',
            });
            renderText.setContent('Hello world!');
            renderBlock.setChildren([renderText]);
            renderDoc.setChildren([renderBlock]);
        });

        describe('when run for the first time', () => {
            beforeEach(() => {
                doc = treeManager.syncWithRenderTree(renderDoc);
            });

            it('builds layout tree', () => {
                expect(doc.renderId).toEqual(renderDoc.id);
                expect(doc.children.length).toEqual(1);
                const page = doc.children[0];
                expect(page.children.length).toEqual(1);
                const block = page.children[0];
                expect(block.renderId).toEqual(renderBlock.id);
                expect(block.children.length).toEqual(1);
                const line = block.children[0];
                expect(line.children.length).toEqual(1);
                const text = line.children[0];
                expect(text.type).toEqual('text');
                if (text.type !== 'text') {
                    throw new Error();
                }
                expect(text.renderId).toEqual(renderText.id);
                expect(text.children.length).toEqual(2);
                const word1 = text.children[0];
                const word2 = text.children[1];
                expect(word1.content).toEqual('Hello ');
                expect(word1.whitespaceSize).toEqual(1);
                expect(word2.content).toEqual('world!');
                expect(word2.whitespaceSize).toEqual(0);
            });
        });

        describe('when run after render tree is updated', () => {
            beforeEach(() => {
                doc = treeManager.syncWithRenderTree(renderDoc);
                renderText.setContent('Hello beautiful world!');
                treeManager.syncWithRenderTree(renderDoc);
            });

            it('builds updated layout tree', () => {
                expect(getContentFromDoc(doc)).toEqual([[[[['Hello ', 'beautiful ', 'world!']]]]]);
            });
        });

        describe('when line overflows', () => {
            beforeEach(() => {
                renderText.setContent(
                    'Hello beautiful world! Hello beautiful world! Hello beautiful world! Hello beautiful world! Hello beautiful world!',
                );
                doc = treeManager.syncWithRenderTree(renderDoc);
            });

            it('breaks line', () => {
                expect(getContentFromDoc(doc)).toEqual([
                    [
                        [
                            [['Hello ', 'beautiful ', 'world! ', 'Hello ']],
                            [['beautiful ', 'world! ', 'Hello ', 'beautiful ']],
                            [['world! ', 'Hello ', 'beautiful ', 'world! ']],
                            [['Hello ', 'beautiful ', 'world!']],
                        ],
                    ],
                ]);
            });
        });

        describe('when line with a single word overflows', () => {
            beforeEach(() => {
                renderText.setContent(
                    'HellobeautifulworldHellobeautifulworldHellobeautifulworldHellobeautifulworldHellobeautifulworld',
                );
                doc = treeManager.syncWithRenderTree(renderDoc);
            });

            it('breaks word', () => {
                expect(getContentFromDoc(doc)).toEqual([
                    [
                        [
                            [['HellobeautifulworldHellobeautifulw']],
                            [['orldHellobeautifulworldHellobeauti']],
                            [['fulworldHellobeautifulworld']],
                        ],
                    ],
                ]);
            });
        });

        describe('when page overflows', () => {
            beforeEach(() => {
                const renderBlocks = [renderBlock];
                for (let n = 0; n < 10; n++) {
                    const newRenderBlock = new BlockRenderNode('block');
                    newRenderBlock.setStyle(renderBlock.style);
                    const newRenderText = new TextRenderNode();
                    newRenderText.setStyle(renderText.style);
                    newRenderText.setContent('Hello world!');
                    newRenderBlock.setChildren([newRenderText]);
                    renderBlocks.push(newRenderBlock);
                }
                renderDoc.setChildren(renderBlocks);
                doc = treeManager.syncWithRenderTree(renderDoc);
            });

            it('breaks page', () => {
                expect(getContentFromDoc(doc)).toEqual([
                    [
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                    ],
                    [
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                        [[['Hello ', 'world!']]],
                    ],
                    [[[['Hello ', 'world!']]]],
                ]);
            });
        });
    });
});
