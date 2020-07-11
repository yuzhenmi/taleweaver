import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import ToggleButton from './ToggleButton';

const UnderlineButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <ToggleButton
            active={!!font.underline}
            disabled={false}
            onClick={() =>
                commandService.executeCommand('tw.state.applyAttribute', 'text', 'text', 'underline', !font.underline)
            }
        >
            <i className="mdi mdi-format-underline" />
        </ToggleButton>
    );
};

export default UnderlineButton;
