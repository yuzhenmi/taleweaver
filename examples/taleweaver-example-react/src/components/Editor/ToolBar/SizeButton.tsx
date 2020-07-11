import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import SelectButton from './SelectButton';

const SizeButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    return (
        <SelectButton
            options={[
                { value: '10' },
                { value: '12' },
                { value: '14' },
                { value: '16' },
                { value: '18' },
                { value: '24' },
                { value: '30' },
                { value: '36' },
                { value: '42' },
            ]}
            width={60}
            value={font.size ? font.size.toString() : ''}
            onChange={(newSize) =>
                commandService.executeCommand('tw.state.applyAttribute', 'text', 'text', 'size', newSize)
            }
        />
    );
};

export default SizeButton;
