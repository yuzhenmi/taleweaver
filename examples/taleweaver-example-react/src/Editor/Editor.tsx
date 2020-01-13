import { IConfig, Taleweaver } from '@taleweaver/core';
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import ToolBar from './ToolBar';

const Wrapper = styled.div``;

const EditorWrapper = styled.div`
    text-align: center;
    .tw--doc--doc {
        font-family: 'Source Sans Pro', sans-serif;
        display: inline-block;
        padding-bottom: 9px;
        counter-reset: page-counter;
    }
    .tw--page--page {
        background: rgba(255, 255, 255, 1);
        margin: 9px auto 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        position: relative;
        &::after {
            counter-increment: page-counter;
            content: 'Page ' counter(page-counter) '';
            position: absolute;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 10px;
            font-family: 'Quicksand', sans-serif;
            font-weight: 500;
            color: rgba(0, 0, 0, 0.45);
            pointer-events: none;
        }
        *::selection {
            background: rgba(255, 255, 255, 1);
        }
    }
`;

interface IProps {
    initialMarkup: string;
    config?: IConfig['tw.core'];
}

export default function Editor({ initialMarkup, config }: IProps) {
    const domRef = useRef<HTMLDivElement>(null);
    const [taleweaver, setTaleweaver] = useState<Taleweaver | null>(null);
    useEffect(() => {
        const mergedConfig: IConfig = {};
        if (config) {
            mergedConfig['tw.core'] = config;
        }
        setTaleweaver(new Taleweaver(initialMarkup, mergedConfig));
    }, []);
    useEffect(() => {
        if (taleweaver && domRef.current) {
            taleweaver.attach(domRef.current);
        }
    }, [taleweaver, domRef.current]);
    return (
        <Wrapper key={1}>
            <ToolBar taleweaver={taleweaver} />
            <EditorWrapper ref={domRef} />
        </Wrapper>
    );
}
