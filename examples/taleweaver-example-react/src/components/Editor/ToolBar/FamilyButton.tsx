import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import SelectButton from './SelectButton';

const FamilyButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <SelectButton
            options={[{ value: 'sans-serif' }]}
            width={120}
            value={font.family || ''}
            onChange={(newFamily) =>
                commandService.executeCommand('tw.state.applyAttributeAround', 'text', 'text', 'family', newFamily)
            }
        />
    );
};

export default FamilyButton;
