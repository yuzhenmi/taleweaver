import { IConfig } from '@taleweaver/core';
import { INode } from '@taleweaver/core/dist/tw/util/serialize';
import { TaleweaverContainer, TaleweaverProvider } from '@taleweaver/react';
import React from 'react';
import styled from 'styled-components';
import ToolBar from './ToolBar';

const Wrapper = styled.div``;

const ContainerWrapper = styled.div`
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
    config?: IConfig['tw.core'];
    initialDoc: INode;
}

const Editor: React.FC<IProps> = ({ config, initialDoc }) => {
    return (
        <TaleweaverProvider>
            <Wrapper>
                <ToolBar />
                <ContainerWrapper>
                    <TaleweaverContainer config={config} initialDoc={initialDoc} />
                </ContainerWrapper>
            </Wrapper>
        </TaleweaverProvider>
    );
};

export default Editor;
