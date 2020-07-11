import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import ToggleButton from './ToggleButton';

const ItalicButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <ToggleButton
            active={!!font.italic}
            disabled={false}
            onClick={() =>
                commandService.executeCommand('tw.state.applyAttribute', 'text', 'text', 'italic', !font.italic)
            }
        >
            <i className="mdi mdi-format-italic" />
        </ToggleButton>
    );
};

export default ItalicButton;
