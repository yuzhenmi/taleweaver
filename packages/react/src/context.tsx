import { IConfig, Taleweaver } from '@taleweaver/core';
import { ISerializable } from '@taleweaver/core/dist/model/serializer';
import React, { useContext, useEffect, useState } from 'react';

function noOp() {}

export interface IValue {
    taleweaver: Taleweaver | null;
    setTaleweaver: (taleweaver: Taleweaver) => any;
}

export const TaleweaverContext = React.createContext<IValue>({
    taleweaver: null,
    setTaleweaver: noOp,
});

export const TaleweaverProvider: React.FC = ({ children }) => {
    const [taleweaver, setTaleweaver] = useState<Taleweaver | null>(null);
    return <TaleweaverContext.Provider value={{ taleweaver, setTaleweaver }}>{children}</TaleweaverContext.Provider>;
};

export interface ITaleweaverContainerProps {
    config?: IConfig['tw.core'];
    initialDoc: ISerializable;
}

export const TaleweaverContainer: React.FC<ITaleweaverContainerProps> = ({ config, initialDoc }) => {
    const { setTaleweaver } = useContext(TaleweaverContext);
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const serializedConfig = config && JSON.stringify(config);
    useEffect(() => {
        if (!container) {
            return;
        }
        const mergedConfig: IConfig = {};
        if (serializedConfig) {
            mergedConfig['tw.core'] = JSON.parse(serializedConfig);
        }
        const taleweaver = new Taleweaver(initialDoc, mergedConfig);
        setTaleweaver(taleweaver);
        taleweaver.attach(container);
    }, [container, serializedConfig, initialDoc]);
    return <div ref={setContainer} />;
};

export function useTaleweaver() {
    const { taleweaver } = useContext(TaleweaverContext);
    return taleweaver;
}

export function useCommandService() {
    const taleweaver = useTaleweaver();
    if (!taleweaver) {
        return null;
    }
    return taleweaver.getServiceRegistry().getService('command');
}

export function useCursorService() {
    const taleweaver = useTaleweaver();
    if (!taleweaver) {
        return null;
    }
    return taleweaver.getServiceRegistry().getService('cursor');
}

export function useRenderService() {
    const taleweaver = useTaleweaver();
    if (!taleweaver) {
        return null;
    }
    return taleweaver.getServiceRegistry().getService('render');
}
