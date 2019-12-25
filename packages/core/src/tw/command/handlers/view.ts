import { ICommandHandler } from '../command';

export const focus: ICommandHandler = async serviceRegistry => {
    serviceRegistry.getService('view').requestFocus();
};
export const blur: ICommandHandler = async serviceRegistry => {
    serviceRegistry.getService('view').requestBlur();
};
