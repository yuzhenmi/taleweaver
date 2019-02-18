import TaleWeaver from '../TaleWeaver';
import Text from '../model/Text';
import BlockViewModel from './BlockViewModel';
import WordViewModel, { Segment } from './WordViewModel';

const WORD_DELIMITERS = [
  ' ',
  '\t',
  '\n',
];

class TextViewModel extends WordViewModel {
  static getType(): string {
    return 'Text';
  }

  static fromInline(taleWeaver: TaleWeaver, blockViewModel: BlockViewModel, inline: Text): TextViewModel[] {
    const content = inline.getContent();
    let wordStartOffset = 0;
    let offset = 1;
    const textViewModels: TextViewModel[] = [];
    for (let contentLength = content.length; offset < contentLength; offset++) {
      const char = content[offset];
      if (WORD_DELIMITERS.indexOf(char) >= 0) {
        textViewModels.push(new TextViewModel(taleWeaver, blockViewModel, [
          {
            inline,
            from: wordStartOffset,
            to: offset,
          },
        ]));
        wordStartOffset = offset + 1;
      }
    }
    if (wordStartOffset < offset - 1) {
      textViewModels.push(new TextViewModel(taleWeaver, blockViewModel, [
        {
          inline,
          from: wordStartOffset,
          to: offset,
        },
      ]));
    }
    return textViewModels;
  }

  static merge(taleWeaver: TaleWeaver, blockViewModel: BlockViewModel, wordViewModels: WordViewModel[]): WordViewModel[] {
    const mergedWordViewModels: WordViewModel[] = [];
    let chainedSegments: Segment[] = [];
    wordViewModels.forEach(wordViewModel => {
      if (!(wordViewModel instanceof TextViewModel)) {
        if (chainedSegments.length > 0) {
          mergedWordViewModels.push(new TextViewModel(taleWeaver, blockViewModel, chainedSegments));
          chainedSegments = [];
        }
        mergedWordViewModels.push(wordViewModel);
        return;
      }
      const textViewModel = wordViewModel as TextViewModel;
      const segments = textViewModel.getSegments();
      const lastSegment = segments[segments.length - 1];
      const inlineContent = lastSegment.inline.getContent();
      if (WORD_DELIMITERS.indexOf(inlineContent[lastSegment.to]) >= 0) {
        if (chainedSegments.length > 0) {
          mergedWordViewModels.push(new TextViewModel(taleWeaver, blockViewModel, [...chainedSegments, ...wordViewModel.getSegments()]));
          chainedSegments = [];
        } else {
          mergedWordViewModels.push(wordViewModel);
        }
      } else {
        chainedSegments.push(...segments);
      }
    });
    if (chainedSegments.length > 0) {
      mergedWordViewModels.push(new TextViewModel(taleWeaver, blockViewModel, chainedSegments));
    }
    return mergedWordViewModels;
  }

  getType(): string {
    return TextViewModel.getType();
  }

  getSize(): number {
    let size = 0;
    this.segments.forEach(segment => {
      size += segment.to - segment.from + 1;
    });
    return size;
  }
}

export default TextViewModel;
