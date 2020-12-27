import { DOMServiceStub } from '../dom/service.stub';
import {
    BlockLayoutNode,
    DocLayoutNode,
    LineLayoutNode,
    PageLayoutNode,
    TextLayoutNode,
    WordLayoutNode,
} from '../layout/node';
import { TextServiceStub } from '../text/service.stub';
import { IDocViewNode, ITextViewNode } from './node';
import { ViewTreeManager } from './tree-manager';

describe('ViewTreeManager', () => {
    let textService: TextServiceStub;
    let domService: DOMServiceStub;
    let treeManager: ViewTreeManager;

    beforeEach(() => {
        textService = new TextServiceStub();
        domService = new DOMServiceStub();
        treeManager = new ViewTreeManager(domService);
    });

    describe('syncWithLayoutTree', () => {
        let layoutDoc: DocLayoutNode;
        let layoutPage: PageLayoutNode;
        let layoutBlock: BlockLayoutNode;
        let layoutLine: LineLayoutNode;
        let layoutText: TextLayoutNode;
        let layoutWord: WordLayoutNode;

        beforeEach(() => {
            layoutDoc = new DocLayoutNode('doc');
            layoutDoc.setStyle({
                pageWidth: 0,
                pageHeight: 0,
                pagePaddingTop: 0,
                pagePaddingBottom: 0,
                pagePaddingLeft: 0,
                pagePaddingRight: 0,
            });
            layoutPage = new PageLayoutNode();
            layoutPage.setStyle({
                width: 0,
                height: 0,
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
            });
            layoutDoc.setChildren([layoutPage]);
            layoutBlock = new BlockLayoutNode('block');
            layoutBlock.setStyle({
                width: 0,
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
            });
            layoutPage.setChildren([layoutBlock]);
            layoutLine = new LineLayoutNode();
            layoutLine.setStyle({
                width: 0,
                lineHeight: 0,
            });
            layoutBlock.setChildren([layoutLine]);
            layoutText = new TextLayoutNode('text');
            layoutText.setStyle({
                weight: 400,
                size: 14,
                family: 'sans-serif',
                letterSpacing: 0,
                underline: false,
                italic: false,
                strikethrough: false,
                color: 'black',
            });
            layoutLine.setChildren([layoutText]);
            layoutWord = new WordLayoutNode(textService);
            layoutWord.setStyle({
                weight: 400,
                size: 14,
                family: 'sans-serif',
                letterSpacing: 0,
                underline: false,
                italic: false,
                strikethrough: false,
                color: 'black',
            });
            layoutWord.setContent('Hello ');
            layoutText.setChildren([layoutWord]);
        });

        describe('when run for the first time', () => {
            it('builds view tree', () => {
                const doc = treeManager.syncWithLayoutTree(layoutDoc);
                expect(doc.layoutId).toEqual(layoutDoc.id);
                const page = doc.children[0];
                expect(page.layoutId).toEqual(layoutPage.id);
                const block = page.children[0];
                expect(block.layoutId).toEqual(layoutBlock.id);
                const line = block.children[0];
                expect(line.layoutId).toEqual(layoutLine.id);
                const text = line.children[0] as ITextViewNode;
                expect(text.layoutId).toEqual(layoutText.id);
                const word = text.children[0];
                expect(word.content).toEqual('Hello ');
            });
        });

        describe('when run after layout tree is updated', () => {
            let layoutWord2: WordLayoutNode;
            let doc: IDocViewNode;

            beforeEach(() => {
                doc = treeManager.syncWithLayoutTree(layoutDoc);
                layoutWord2 = new WordLayoutNode(textService);
                layoutWord2.setStyle({
                    weight: 400,
                    size: 14,
                    family: 'sans-serif',
                    letterSpacing: 0,
                    underline: false,
                    italic: false,
                    strikethrough: false,
                    color: 'black',
                });
                layoutWord2.setContent('world!');
                layoutText.setChildren([layoutWord, layoutWord2]);
                treeManager.syncWithLayoutTree(layoutDoc);
            });

            it('builds updated view tree', () => {
                expect(doc.layoutId).toEqual(layoutDoc.id);
                const page = doc.children[0];
                expect(page.layoutId).toEqual(layoutPage.id);
                const block = page.children[0];
                expect(block.layoutId).toEqual(layoutBlock.id);
                const line = block.children[0];
                expect(line.layoutId).toEqual(layoutLine.id);
                const text = line.children[0] as ITextViewNode;
                expect(text.layoutId).toEqual(layoutText.id);
                const word1 = text.children[0];
                expect(word1.content).toEqual('Hello ');
                const word2 = text.children[1];
                expect(word2.content).toEqual('world!');
            });
        });
    });
});
