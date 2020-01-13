import { Taleweaver } from '@taleweaver/core';
import { ITextStyle } from '@taleweaver/core/dist/tw/component/components/text';
import React, { useEffect, useMemo, useState } from 'react';
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

function getTextStyles(taleweaver: Taleweaver): ITextStyle[] {
    const renderService = taleweaver.getServiceRegistry().getService('render');
    const cursorService = taleweaver.getServiceRegistry().getService('cursor');
    const cursorState = cursorService.getCursorState();
    const styles = renderService.getStylesBetween(
        Math.min(cursorState.anchor, cursorState.head),
        Math.max(cursorState.anchor, cursorState.head),
    );
    if (!styles.text) {
        return [];
    }
    if (!styles.text.text) {
        return [];
    }
    return styles.text.text as ITextStyle[];
}

export default function ToolBar({ taleweaver }: Props) {
    const [textStyles, setTextStyles] = useState<ITextStyle[]>([]);
    const updateTextStyle = useMemo(
        () => (taleweaver: Taleweaver) => {
            setTextStyles(getTextStyles(taleweaver));
        },
        [],
    );
    useEffect(() => {
        if (!taleweaver) {
            return;
        }
        const cursorService = taleweaver.getServiceRegistry().getService('cursor');
        const renderService = taleweaver.getServiceRegistry().getService('render');
        cursorService.onDidUpdateCursor(event => updateTextStyle(taleweaver));
        renderService.onDidUpdateRenderState(event => updateTextStyle(taleweaver));
        updateTextStyle(taleweaver);
    }, [taleweaver]);
    const font = new Set(textStyles.map(s => s.font)).size === 1 ? textStyles[0].font : null;
    const size = new Set(textStyles.map(s => s.size)).size === 1 ? textStyles[0].size : null;
    const bold = new Set(textStyles.map(s => s.weight > 400)).size === 1 ? textStyles[0].weight > 400 : false;
    const italic = new Set(textStyles.map(s => s.italic)).size === 1 ? textStyles[0].italic : false;
    const underline = new Set(textStyles.map(s => s.underline)).size === 1 ? textStyles[0].underline : false;
    const strikethrough =
        new Set(textStyles.map(s => s.strikethrough)).size === 1 ? textStyles[0].strikethrough : false;
    const color = new Set(textStyles.map(s => s.color)).size === 1 ? textStyles[0].color : null;
    return (
        <Wrapper>
            <Container>
                <Group>
                    <SelectItem width={120} value={'Normal'} disabled={false} onChange={event => null}>
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
                    <SelectItem width={120} value={font || ''} disabled={font === null} onChange={event => null}>
                        <option value="" style={{ display: 'none' }}></option>
                        <option value="sans-serif">sans-serif</option>
                    </SelectItem>
                </Group>
                <Group>
                    <SelectItem
                        width={60}
                        value={size ? size.toString() : ''}
                        disabled={size === null}
                        onChange={event => null}
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
                    <Item active={bold} disabled={false} onClick={() => null}>
                        <i className="mdi mdi-format-bold" />
                    </Item>
                    <Item active={italic} disabled={false} onClick={() => null}>
                        <i className="mdi mdi-format-italic" />
                    </Item>
                    <Item active={underline} disabled={false} onClick={() => null}>
                        <i className="mdi mdi-format-underline" />
                    </Item>
                    <Item active={strikethrough} disabled={false} onClick={() => null}>
                        <i className="mdi mdi-format-strikethrough-variant" />
                    </Item>
                    <Item active={false} disabled={color === null} onClick={() => null}>
                        <i className="mdi mdi-format-color-text" style={{ position: 'relative', top: '-2px' }} />
                        <ItemColorLine color={color || 'transparent'} />
                    </Item>
                </Group>
            </Container>
        </Wrapper>
    );
}
