import { CopyCommandHandler, PasteCommandHandler } from '../command/handlers/clipboard';
import {
    MoveBackwardByLineCommandHandler,
    MoveBackwardByWordCommandHandler,
    MoveBackwardCommandHandler,
    MoveCommandHandler,
    MoveForwardByLineCommandHandler,
    MoveForwardByWordCommandHandler,
    MoveForwardCommandHandler,
    MoveHeadBackwardByLineCommandHandler,
    MoveHeadBackwardByWordCommandHandler,
    MoveHeadBackwardCommandHandler,
    MoveHeadCommandHandler,
    MoveHeadForwardByLineCommandHandler,
    MoveHeadForwardByWordCommandHandler,
    MoveHeadToDocEndCommandHandler,
    MoveHeadToDocStartCommandHandler,
    MoveHeadToLineEndCommandHandler,
    MoveHeadToLineStartCommandHandler,
    MoveToDocEndCommandHandler,
    MoveToDocStartCommandHandler,
    MoveToLineEndCommandHandler,
    MoveToLineStartCommandHandler,
    SelectAllCommandHandler,
    SelectBlockCommandHandler,
    SelectWordCommandHandle,
} from '../command/handlers/cursor';
import { RedoCommandHandler, UndoCommandHandler } from '../command/handlers/history';
import {
    ApplyAttributesCommandHandler,
    ApplyMarksCommandHandler,
    BreakLineCommandHandler,
    DeleteBackwardCommandHandler,
    DeleteForwardCommandHandler,
    InsertCommandHandler,
} from '../command/handlers/state';
import { BlurCommandHandler, FocusCommandHandler } from '../command/handlers/view';
import { DocComponent } from '../component/components/doc';
import { ParagraphComponent } from '../component/components/paragraph';
import { Color } from '../mark/marks/color';
import { Family } from '../mark/marks/family';
import { Italic } from '../mark/marks/italic';
import { LetterSpacing } from '../mark/marks/letter-spacing';
import { Size } from '../mark/marks/size';
import { Strikethrough } from '../mark/marks/strikethrough';
import { Underline } from '../mark/marks/underline';
import { Weight } from '../mark/marks/weight';
import { IConfig } from './config';

export function buildBaseConfig(): IConfig {
    return {
        commands: {
            'tw.clipboard.copy': CopyCommandHandler,
            'tw.clipboard.paste': PasteCommandHandler,
            'tw.cursor.move': MoveCommandHandler,
            'tw.cursor.moveBackwardByLine': MoveBackwardByLineCommandHandler,
            'tw.cursor.moveForwardByLine': MoveForwardByLineCommandHandler,
            'tw.cursor.moveBackward': MoveBackwardCommandHandler,
            'tw.cursor.moveForward': MoveForwardCommandHandler,
            'tw.cursor.moveBackwardByWord': MoveBackwardByWordCommandHandler,
            'tw.cursor.moveForwardByWord': MoveForwardByWordCommandHandler,
            'tw.cursor.moveToLineStart': MoveToLineStartCommandHandler,
            'tw.cursor.moveToLineEnd': MoveToLineEndCommandHandler,
            'tw.cursor.moveToDocStart': MoveToDocStartCommandHandler,
            'tw.cursor.moveToDocEnd': MoveToDocEndCommandHandler,
            'tw.cursor.moveHead': MoveHeadCommandHandler,
            'tw.cursor.moveHeadBackwardByLine': MoveHeadBackwardByLineCommandHandler,
            'tw.cursor.moveHeadForwardByLine': MoveHeadForwardByLineCommandHandler,
            'tw.cursor.moveHeadBackward': MoveHeadBackwardCommandHandler,
            'tw.cursor.moveHeadForward': MoveHeadForwardByLineCommandHandler,
            'tw.cursor.moveHeadBackwardByWord': MoveHeadBackwardByWordCommandHandler,
            'tw.cursor.moveHeadForwardByWord': MoveHeadForwardByWordCommandHandler,
            'tw.cursor.moveHeadToLineStart': MoveHeadToLineStartCommandHandler,
            'tw.cursor.moveHeadToLineEnd': MoveHeadToLineEndCommandHandler,
            'tw.cursor.moveHeadToDocStart': MoveHeadToDocStartCommandHandler,
            'tw.cursor.moveHeadToDocEnd': MoveHeadToDocEndCommandHandler,
            'tw.cursor.selectAll': SelectAllCommandHandler,
            'tw.cursor.selectWord': SelectWordCommandHandle,
            'tw.cursor.selectBlock': SelectBlockCommandHandler,
            'tw.history.undo': UndoCommandHandler,
            'tw.history.redo': RedoCommandHandler,
            'tw.state.insert': InsertCommandHandler,
            'tw.state.deleteBackward': DeleteBackwardCommandHandler,
            'tw.state.deleteForward': DeleteForwardCommandHandler,
            'tw.state.breakLine': BreakLineCommandHandler,
            'tw.state.applyAttributes': ApplyAttributesCommandHandler,
            'tw.state.applyMarks': ApplyMarksCommandHandler,
            'tw.view.focus': FocusCommandHandler,
            'tw.view.blur': BlurCommandHandler,
        },
        components: [new DocComponent('doc'), new ParagraphComponent('paragraph')],
        cursor: {
            disable: false,
            caretColor: `hsla(213, 100%, 50%, 1)`,
            caretInactiveColor: 'hsla(0, 0%, 0%, 0.5)',
            selectionColor: `hsla(213, 100%, 50%, 0.2)`,
            selectionInactiveColor: 'hsla(0, 0%, 0%, 0.08)',
        },
        history: {
            collapseThreshold: 500,
            maxCollapseDuration: 2000,
        },
        keyBindings: {
            common: {
                left: {
                    command: 'tw.cursor.moveBackward',
                    preventDefault: true,
                },
                right: {
                    command: 'tw.cursor.moveForward',
                    preventDefault: true,
                },
                up: {
                    command: 'tw.cursor.moveBackwardByLine',
                    preventDefault: true,
                },
                down: {
                    command: 'tw.cursor.moveForwardByLine',
                    preventDefault: true,
                },
                'shift+left': {
                    command: 'tw.cursor.moveHeadBackward',
                    preventDefault: true,
                },
                'shift+right': {
                    command: 'tw.cursor.moveHeadForward',
                    preventDefault: true,
                },
                'shift+up': {
                    command: 'tw.cursor.moveHeadBackwardByLine',
                    preventDefault: true,
                },
                'shift+down': {
                    command: 'tw.cursor.moveHeadForwardByLine',
                    preventDefault: true,
                },
                backspace: {
                    command: 'tw.state.deleteBackward',
                    preventDefault: true,
                },
                delete: {
                    command: 'tw.state.deleteForward',
                    preventDefault: true,
                },
                enter: { command: 'tw.state.breakLine', preventDefault: true },
            },
            macos: {
                'alt+left': { command: 'tw.cursor.moveBackwardByWord' },
                'alt+right': { command: 'tw.cursor.moveForwardByWord' },
                'shift+alt+left': {
                    command: 'tw.cursor.moveHeadBackwardByWord',
                },
                'shift+alt+right': {
                    command: 'tw.cursor.moveHeadForwardByWord',
                },
                'cmd+left': { command: 'tw.cursor.moveToLineStart' },
                'cmd+right': { command: 'tw.cursor.moveToLineEnd' },
                'cmd+up': { command: 'tw.cursor.moveToDocStart' },
                'cmd+down': { command: 'tw.cursor.moveToDocEnd' },
                'shift+cmd+left': { command: 'tw.cursor.moveHeadToLineStart' },
                'shift+cmd+right': { command: 'tw.cursor.moveHeadToLineEnd' },
                'shift+cmd+up': { command: 'tw.cursor.moveHeadToDocStart' },
                'shift+cmd+down': { command: 'tw.cursor.moveHeadToDocEnd' },
                'cmd+a': { command: 'tw.cursor.selectAll' },
                'cmd+z': { command: 'tw.history.undo', preventDefault: true },
                'shift+cmd+z': {
                    command: 'tw.history.redo',
                    preventDefault: true,
                },
            },
            windows: {
                'ctrl+left': { command: 'tw.cursor.moveBackwardByWord' },
                'ctrl+right': { command: 'tw.cursor.moveForwardByWord' },
                'ctrl+shift+left': {
                    command: 'tw.cursor.moveHeadBackwardByWord',
                },
                'ctrl+shift+right': {
                    command: 'tw.cursor.moveHeadForwardByWord',
                },
                home: { command: 'tw.cursor.moveToLineStart' },
                end: { command: 'tw.cursor.moveToLineEnd' },
                'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                'ctrl+a': { command: 'tw.cursor.selectAll' },
                'ctrl+z': { command: 'tw.history.undo', preventDefault: true },
                'ctrl+shift+z': {
                    command: 'tw.history.redo',
                    preventDefault: true,
                },
            },
            linux: {
                'ctrl+left': { command: 'tw.cursor.moveBackwardByWord' },
                'ctrl+right': { command: 'tw.cursor.moveForwardByWord' },
                'ctrl+shift+left': {
                    command: 'tw.cursor.moveHeadBackwardByWord',
                },
                'ctrl+shift+right': {
                    command: 'tw.cursor.moveHeadForwardByWord',
                },
                home: { command: 'tw.cursor.moveToLineStart' },
                end: { command: 'tw.cursor.moveToLineEnd' },
                'ctrl+home': { command: 'tw.cursor.moveToDocStart' },
                'ctrl+end': { command: 'tw.cursor.moveToDocEnd' },
                'shift+home': { command: 'tw.cursor.moveHeadToLineStart' },
                'shift+end': { command: 'tw.cursor.moveHeadToLineEnd' },
                'ctrl+shift+home': { command: 'tw.cursor.moveHeadToDocStart' },
                'ctrl+shift+end': { command: 'tw.cursor.moveHeadToDocEnd' },
                'ctrl+a': { command: 'tw.cursor.selectAll' },
                'ctrl+z': { command: 'tw.history.undo', preventDefault: true },
                'ctrl+shift+z': {
                    command: 'tw.history.redo',
                    preventDefault: true,
                },
            },
        },
        markTypes: [
            new Color('color'),
            new Family('family'),
            new Italic('italic'),
            new LetterSpacing('letterSpacing'),
            new Size('size'),
            new Strikethrough('strikethrough'),
            new Underline('underline'),
            new Weight('weight'),
        ],
    };
}
