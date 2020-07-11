import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import ToggleButton from './ToggleButton';

const WeightButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <ToggleButton
            active={!!font.weight && font.weight > 400}
            disabled={false}
            onClick={() =>
                commandService.executeCommand(
                    'tw.state.applyAttribute',
                    'text',
                    'text',
                    'weight',
                    font.weight && font.weight > 400 ? 400 : 700,
                )
            }
        >
            <i className="mdi mdi-format-bold" />
        </ToggleButton>
    );
};

export default WeightButton;
