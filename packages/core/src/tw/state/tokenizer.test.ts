import { CLOSE_TOKEN } from './token';
import { Tokenizer } from './tokenizer';

describe('Tokenizer', () => {
    let tokenizer: Tokenizer;

    beforeEach(() => {
        tokenizer = new Tokenizer();
    });

    describe('tokenize', () => {
        it('tokenizes markup', () => {
            const markup =
                '<doc {"id":"doc"}><paragraph {"id":"1"}><text {"id":"2"}>Hello</><text {"id":"3","bold":true}>world</></></>';
            const tokens = tokenizer.tokenize(markup);
            expect(tokens).toEqual([
                { componentId: 'doc', partId: 'doc', id: 'doc', attributes: {} },
                { componentId: 'paragraph', partId: 'paragraph', id: '1', attributes: {} },
                { componentId: 'text', partId: 'text', id: '2', attributes: {} },
                'H',
                'e',
                'l',
                'l',
                'o',
                CLOSE_TOKEN,
                { componentId: 'text', partId: 'text', id: '3', attributes: { bold: true } },
                'w',
                'o',
                'r',
                'l',
                'd',
                CLOSE_TOKEN,
                CLOSE_TOKEN,
                CLOSE_TOKEN,
            ]);
        });

        describe('when attributes are malformed', () => {
            it('throws error', () => {
                const markup = '<doc {"id":"doc"}><paragraph {"id":"1"}><text {"id";"2"}>Hello</></></>';
                expect(() => tokenizer.tokenize(markup)).toThrowError();
            });
        });

        describe('when is is missing', () => {
            it('throws error', () => {
                const markup = '<doc {}><paragraph {"id":"1"}><text {"id":"2"}>Hello</></></>';
                expect(() => tokenizer.tokenize(markup)).toThrowError();
            });
        });

        describe('when tag name is missing', () => {
            it('throws error', () => {
                const markup = '< {"id":"doc"}><paragraph {"id":"1"}><text {"id":"2"}>Hello</></></>';
                expect(() => tokenizer.tokenize(markup)).toThrowError();
            });
        });

        describe('when run twice', () => {
            it('throws error', () => {
                const markup = '<doc {"id":"doc"}><paragraph {"id":"1"}><text {"id":"2"}>Hello</></></>';
                tokenizer.tokenize(markup);
                expect(() => tokenizer.tokenize(markup)).toThrowError();
            });
        });
    });
});
