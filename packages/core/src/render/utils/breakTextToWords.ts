const BREAKABLES = [
    ' ',
    '\n',
    '\t',
];

export interface Word {
    text: string;
    breakable: boolean;
}

export default function breakTextToWorkds(text: string): Word[] {
    const words: Word[] = [];
    let word = '';
    for (let n = 0, nn = text.length; n < nn; n++) {
        const char = text[n];
        word += char;
        if (BREAKABLES.includes(char)) {
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
