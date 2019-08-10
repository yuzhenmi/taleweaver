import selectAll from '../../command/commands/selectAll';
import deleteBackward from './deleteBackward';
import deleteForward from './deleteForward';
import insert from './insert';
import moveCursorHeadLeft from './moveCursorHeadLeft';
import moveCursorHeadLeftByWord from './moveCursorHeadLeftByWord';
import moveCursorHeadRight from './moveCursorHeadRight';
import moveCursorHeadRightByWord from './moveCursorHeadRightByWord';
import moveCursorHeadTo from './moveCursorHeadTo';
import moveCursorHeadToLeftOfDoc from './moveCursorHeadToLeftOfDoc';
import moveCursorHeadToLeftOfLine from './moveCursorHeadToLeftOfLine';
import moveCursorHeadToLineAbove from './moveCursorHeadToLineAbove';
import moveCursorHeadToLineBelow from './moveCursorHeadToLineBelow';
import moveCursorHeadToRightOfDoc from './moveCursorHeadToRightOfDoc';
import moveCursorHeadToRightOfLine from './moveCursorHeadToRightOfLine';
import moveCursorLeft from './moveCursorLeft';
import moveCursorLeftByWord from './moveCursorLeftByWord';
import moveCursorRight from './moveCursorRight';
import moveCursorRightByWord from './moveCursorRightByWord';
import moveCursorTo from './moveCursorTo';
import moveCursorToLeftOfDoc from './moveCursorToLeftOfDoc';
import moveCursorToLeftOfLine from './moveCursorToLeftOfLine';
import moveCursorToLineAbove from './moveCursorToLineAbove';
import moveCursorToLineBelow from './moveCursorToLineBelow';
import moveCursorToRightOfDoc from './moveCursorToRightOfDoc';
import moveCursorToRightOfLine from './moveCursorToRightOfLine';
import split from './split';

export {
    deleteBackward,
    deleteForward,
    insert,
    moveCursorTo,
    moveCursorHeadTo,
    moveCursorLeft,
    moveCursorRight,
    moveCursorHeadLeft,
    moveCursorHeadRight,
    moveCursorLeftByWord,
    moveCursorRightByWord,
    moveCursorHeadLeftByWord,
    moveCursorHeadRightByWord,
    moveCursorToLeftOfLine,
    moveCursorToRightOfLine,
    moveCursorHeadToLeftOfLine,
    moveCursorHeadToRightOfLine,
    moveCursorToLineAbove,
    moveCursorToLineBelow,
    moveCursorHeadToLineAbove,
    moveCursorHeadToLineBelow,
    moveCursorToLeftOfDoc,
    moveCursorToRightOfDoc,
    moveCursorHeadToLeftOfDoc,
    moveCursorHeadToRightOfDoc,
    selectAll,
    split,
};
