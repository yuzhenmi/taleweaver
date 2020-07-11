import { IConfig, Taleweaver } from '@taleweaver/core';
import { IResolvedFont } from '@taleweaver/core/dist/tw/render/service';
import { INode, parse } from '@taleweaver/core/dist/tw/util/serialize';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';

function noOp() {}

export interface IValue {
    taleweaver: Taleweaver | null;
    setTaleweaver: (taleweaver: Taleweaver) => any;
    font: IResolvedFont | null;
}

export const TaleweaverContext = React.createContext<IValue>({
    taleweaver: null,
    setTaleweaver: noOp,
    font: null,
});

function resolveFont(taleweaver: Taleweaver) {
    const cursorService = taleweaver.getServiceRegistry().getService('cursor');
    const renderService = taleweaver.getServiceRegistry().getService('render');
    const { anchor, head } = cursorService.getCursor();
    return renderService.resolveFont(Math.min(anchor, head), Math.max(anchor, head));
}

export const TaleweaverProvider: React.FC = ({ children }) => {
    const [taleweaver, setTaleweaver] = useState<Taleweaver | null>(null);
    const [font, setFont] = useState<IResolvedFont | null>(null);
    const refreshFront = useCallback(() => {
        if (!taleweaver) {
            return;
        }
        setFont(resolveFont(taleweaver));
    }, [taleweaver]);
    useEffect(() => {
        if (!taleweaver) {
            return;
        }
        const cursorService = taleweaver.getServiceRegistry().getService('cursor');
        const renderService = taleweaver.getServiceRegistry().getService('render');
        cursorService.onDidUpdate((event) => refreshFront());
        renderService.onDidUpdateRenderState((event) => refreshFront());
        refreshFront();
    }, [taleweaver, refreshFront]);
    return (
        <TaleweaverContext.Provider value={{ taleweaver, setTaleweaver, font }}>{children}</TaleweaverContext.Provider>
    );
};

export interface ITaleweaverContainerProps {
    config?: IConfig['tw.core'];
    initialDoc: INode;
}

export const TaleweaverContainer: React.FC<ITaleweaverContainerProps> = ({ config, initialDoc }) => {
    const { taleweaver, setTaleweaver } = useContext(TaleweaverContext);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const container = containerRef.current;
    useEffect(() => {
        const mergedConfig: IConfig = {};
        if (config) {
            mergedConfig['tw.core'] = config;
        }
        const doc = parse(initialDoc, mergedConfig);
        setTaleweaver(new Taleweaver(doc, mergedConfig));
    }, [config, initialDoc]);
    useEffect(() => {
        if (taleweaver && container) {
            taleweaver.attach(container);
        }
    }, [taleweaver, container, initialDoc]);
    return <div ref={containerRef} />;
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

export function useFont() {
    const { font } = useContext(TaleweaverContext);
    return font;
}
