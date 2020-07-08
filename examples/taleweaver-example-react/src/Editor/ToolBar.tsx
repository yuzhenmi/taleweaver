import { Taleweaver } from '@taleweaver/core';
import { IResolvedFont } from '@taleweaver/core/dist/tw/render/service';
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';

const Wrapper = styled.div`
    position: sticky;
    top: 0;
    padding: 3px 24px;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.09);
    z-index: 10;
`;

const Container = styled.div`
    display: flex;
    margin: 0 auto;
    width: 816px;
`;

const Group = styled.div`
    flex: 0 0 auto;
    display: flex;
    border-radius: 4px;
    padding: 0 6px;
    position: relative;
    &::before {
        content: '';
        position: absolute;
        top: 9px;
        bottom: 9px;
        left: 0;
        width: 1px;
        background: rgba(0, 0, 0, 0.15);
    }
    &:last-child {
        &::after {
            content: '';
            position: absolute;
            top: 9px;
            bottom: 9px;
            right: 0;
            width: 1px;
            background: rgba(0, 0, 0, 0.15);
        }
    }
`;

interface ItemProps {
    disabled: boolean;
    active: boolean;
}

const Item = styled.button<ItemProps>`
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 36px;
    height: 36px;
    font-size: 18px;
    position: relative;
    color: rgba(0, 0, 0, 0.85);
    background: transparent;
    padding: 0;
    border: none;
    border-radius: 3px;
    outline: none;
    &:after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 3px;
        right: 3px;
        height: 3px;
    }
    &:hover,
    &:focus {
        background: rgba(0, 0, 0, 0.04);
    }
    ${({ disabled }) =>
        disabled &&
        `
        opacity: 0.45;
        &:hover,
        &:focus {
            background: transparent;
        }
    `}
    ${({ active }) =>
        active &&
        `
        color: rgba(255, 0, 0, 1);
        &:after {
            background: rgba(255, 0, 0, 1);
        }
    `}
`;

interface SelectItemProps {
    disabled: boolean;
    width: number;
}

const SelectItem = styled.select<SelectItemProps>`
    -webkit-appearance: none;
    border: none;
    font-size: 12px;
    font-weight: 500;
    width: ${({ width }) => width}px;
    background: white;
    border-radius: 3px;
    padding: 0 9px;
    outline: none;
    position: relative;
    &:hover,
    &:focus {
        background: rgba(0, 0, 0, 0.04);
    }
    option {
        color: rgba(0, 0, 0, 0.85);
    }
    ${({ disabled }) =>
        disabled &&
        `
        opacity: 0.45;
        &:hover,
        &:focus {
            background: transparent;
        }
    `}
`;

interface ItemColorLineProps {
    color: string;
}

const ItemColorLine = styled.div<ItemColorLineProps>`
    position: absolute;
    bottom: 8px;
    left: 9px;
    right: 9px;
    height: 3px;
    background: ${({ color }) => color};
`;

interface Props {
    taleweaver: Taleweaver | null;
}

function resolveFont(taleweaver: Taleweaver) {
    const cursorService = taleweaver.getServiceRegistry().getService('cursor');
    const renderService = taleweaver.getServiceRegistry().getService('render');
    const { anchor, head } = cursorService.getCursor();
    return renderService.resolveFont(Math.min(anchor, head), Math.max(anchor, head));
}

export default function ToolBar({ taleweaver }: Props) {
    const [font, setFont] = useState<IResolvedFont | null>(null);
    const refreshFront = useCallback((taleweaver: Taleweaver) => {
        setFont(resolveFont(taleweaver));
    }, []);
    useEffect(() => {
        if (!taleweaver) {
            return;
        }
        const cursorService = taleweaver.getServiceRegistry().getService('cursor');
        const renderService = taleweaver.getServiceRegistry().getService('render');
        cursorService.onDidUpdate((event) => refreshFront(taleweaver));
        renderService.onDidUpdateRenderState((event) => refreshFront(taleweaver));
        refreshFront(taleweaver);
    }, [taleweaver, refreshFront]);
    const commandService = taleweaver?.getServiceRegistry().getService('command');
    if (!font) {
        return null;
    }
    return (
        <Wrapper>
            <Container>
                <Group>
                    <SelectItem width={120} value={'Normal'} disabled={false} onChange={(event) => null}>
                        <option value="" style={{ display: 'none' }}></option>
                        <option value="Normal">Normal text</option>
                        <option value="Title">Title</option>
                        <option value="Subtitle">Subtitle</option>
                        <option value="Heading 1">Heading 1</option>
                        <option value="Heading 2">Heading 2</option>
                        <option value="Heading 3">Heading 3</option>
                    </SelectItem>
                </Group>
                <Group>
                    <SelectItem
                        width={120}
                        value={font.family || ''}
                        disabled={font.family === null}
                        onChange={(event) => null}
                    >
                        <option value="" style={{ display: 'none' }}></option>
                        <option value="sans-serif">sans-serif</option>
                    </SelectItem>
                </Group>
                <Group>
                    <SelectItem
                        width={60}
                        value={font.size ? font.size.toString() : ''}
                        disabled={font.size === null}
                        onChange={(event) => null}
                    >
                        <option value="" style={{ display: 'hidden' }} />
                        <option value="10">10</option>
                        <option value="12">12</option>
                        <option value="14">14</option>
                        <option value="16">16</option>
                        <option value="18">18</option>
                        <option value="24">24</option>
                        <option value="30">30</option>
                        <option value="36">36</option>
                        <option value="42">42</option>
                    </SelectItem>
                </Group>
                <Group>
                    <Item
                        active={!!font.weight && font.weight > 400}
                        disabled={false}
                        onClick={() =>
                            commandService!.executeCommand(
                                'tw.state.applyAttribute',
                                'text',
                                'text',
                                'weight',
                                font.weight && font.weight > 400 ? 400 : 700,
                            )
                        }
                    >
                        <i className="mdi mdi-format-bold" />
                    </Item>
                    <Item
                        active={!!font.italic}
                        disabled={false}
                        onClick={() =>
                            commandService!.executeCommand(
                                'tw.state.applyAttribute',
                                'text',
                                'text',
                                'italic',
                                !font.italic,
                            )
                        }
                    >
                        <i className="mdi mdi-format-italic" />
                    </Item>
                    <Item
                        active={!!font.underline}
                        disabled={false}
                        onClick={() =>
                            commandService!.executeCommand(
                                'tw.state.applyAttribute',
                                'text',
                                'text',
                                'underline',
                                !font.underline,
                            )
                        }
                    >
                        <i className="mdi mdi-format-underline" />
                    </Item>
                    <Item
                        active={!!font.strikethrough}
                        disabled={false}
                        onClick={() =>
                            commandService!.executeCommand(
                                'tw.state.applyAttribute',
                                'text',
                                'text',
                                'strikethrough',
                                !font.strikethrough,
                            )
                        }
                    >
                        <i className="mdi mdi-format-strikethrough-variant" />
                    </Item>
                    <Item active={false} disabled={font.color === null} onClick={() => null}>
                        <i className="mdi mdi-format-color-text" style={{ position: 'relative', top: '-2px' }} />
                        <ItemColorLine color={font.color || 'transparent'} />
                    </Item>
                </Group>
            </Container>
        </Wrapper>
    );
}
