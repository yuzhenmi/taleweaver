const BREAKABLE_CHARS = [' ', '\n', '\t'];

export interface IWord {
    text: string;
    breakable: boolean;
}

export function breakTextToWords(text: string): IWord[] {
    const words: IWord[] = [];
    let word = '';
    for (let n = 0, nn = text.length; n < nn; n++) {
        const char = text[n];
        word += char;
        if (BREAKABLE_CHARS.includes(char)) {
            words.push({
                text: word,
                breakable: true,
            });
            word = '';
        }
    }
    if (word.length > 0) {
        words.push({
            text: word,
            breakable: false,
        });
    }
    return words;
}
