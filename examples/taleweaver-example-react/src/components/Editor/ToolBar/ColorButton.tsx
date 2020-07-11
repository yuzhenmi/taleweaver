import { useCommandService, useFont } from '@taleweaver/react';
import React, { useEffect, useState } from 'react';
import { SketchPicker } from 'react-color';
import { usePopper } from 'react-popper';
import styled from 'styled-components';
import Box from 'ui-box';
import ToggleButton from './ToggleButton';

interface IUnderlineProps {
    color: string;
}

const Underline = styled.div<IUnderlineProps>`
    position: absolute;
    bottom: 8px;
    left: 9px;
    right: 9px;
    height: 3px;
    background: ${({ color }) => color};
`;

const ColorButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    const [open, setOpen] = useState(false);
    const [buttonElement, setButtonElement] = useState<HTMLButtonElement | null>(null);
    const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
    const popper = usePopper(buttonElement, popperElement);
    useEffect(() => {
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (popperElement && target && popperElement.contains(target)) {
                return;
            }
            setOpen(false);
        };
        window.addEventListener('mousedown', handleMouseDown);
        return () => window.removeEventListener('mousedown', handleMouseDown);
    }, [popperElement, setOpen]);
    if (!commandService || !font) {
        return null;
    }
    return (
        <>
            <ToggleButton
                active={false}
                disabled={font.color === null}
                onClick={() => setOpen(!open)}
                ref={setButtonElement}
            >
                <i className="mdi mdi-format-color-text" style={{ position: 'relative', top: '-2px' }} />
                <Underline color={font.color || 'transparent'} />
            </ToggleButton>
            <div ref={setPopperElement} style={{ ...popper.styles.popper, top: open ? undefined : -99999999 }}>
                <Box userSelect="none">
                    <SketchPicker
                        color={font.color || '#000000'}
                        onChange={({ hex }) =>
                            commandService.executeCommand('tw.state.applyAttribute', 'text', 'text', 'color', hex)
                        }
                    />
                </Box>
            </div>
        </>
    );
};

export default ColorButton;
