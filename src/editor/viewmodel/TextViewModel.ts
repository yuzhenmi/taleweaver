import TaleWeaver from '../TaleWeaver';
import Text from '../model/Text';
import WordViewModel, { Parent, Segment } from './WordViewModel';

const WORD_DELIMITERS = [
  ' ',
  '\t',
  '\n',
];

class TextViewModel extends WordViewModel {
  static getType(): string {
    return 'Text';
  }

  static fromInline(taleWeaver: TaleWeaver, inline: Text, parent: Parent): TextViewModel[] {
    const content = inline.getContent();
    let wordStartOffset = 0;
    let offset = 0;
    const textViewModels: TextViewModel[] = [];
    for (let contentLength = content.length; offset < contentLength; offset++) {
      const char = content[offset];
      if (WORD_DELIMITERS.indexOf(char) >= 0) {
        textViewModels.push(new TextViewModel(taleWeaver, [
          {
            inline,
            from: wordStartOffset,
            to: offset,
          },
        ], parent));
        wordStartOffset = offset + 1;
      }
    }
    if (wordStartOffset < offset - 1) {
      textViewModels.push(new TextViewModel(taleWeaver, [
        {
          inline,
          from: wordStartOffset,
          to: offset - 1,
        },
      ], parent));
    }
    return textViewModels;
  }

  static postProcess(taleWeaver: TaleWeaver, wordViewModels: WordViewModel[], parent: Parent): WordViewModel[] {
    const mergedWordViewModels: WordViewModel[] = [];
    let chainedSegments: Segment[] = [];
    wordViewModels.forEach(wordViewModel => {
      if (!(wordViewModel instanceof TextViewModel)) {
        if (chainedSegments.length > 0) {
          mergedWordViewModels.push(new TextViewModel(taleWeaver, chainedSegments, parent));
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
          mergedWordViewModels.push(new TextViewModel(taleWeaver, [...chainedSegments, ...wordViewModel.getSegments()], parent));
          chainedSegments = [];
        } else {
          mergedWordViewModels.push(wordViewModel);
        }
      } else {
        chainedSegments.push(...segments);
      }
    });
    if (chainedSegments.length > 0) {
      mergedWordViewModels.push(new TextViewModel(taleWeaver, chainedSegments, parent));
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
