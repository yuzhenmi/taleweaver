import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import ToggleButton from './ToggleButton';

const StrikethroughButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <ToggleButton
            active={!!font.strikethrough}
            disabled={false}
            onClick={() =>
                commandService.executeCommand(
                    'tw.state.applyAttribute',
                    'text',
                    'text',
                    'strikethrough',
                    !font.strikethrough,
                )
            }
        >
            <i className="mdi mdi-format-strikethrough-variant" />
        </ToggleButton>
    );
};

export default StrikethroughButton;
