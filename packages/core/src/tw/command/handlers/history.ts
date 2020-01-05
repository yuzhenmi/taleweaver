import { ICommandHandler } from '../command';

export const undo: ICommandHandler = async serviceRegistry => {
    serviceRegistry.getService('history').undo();
};

export const redo: ICommandHandler = async serviceRegistry => {
    serviceRegistry.getService('history').redo();
};
