import { useCommandService, useFont } from '@taleweaver/react';
import React from 'react';
import SelectButton from './SelectButton';

const VariantButton: React.FC = () => {
    const commandService = useCommandService();
    const font = useFont();
    if (!commandService || !font) {
        return null;
    }
    // TODO
    return (
        <SelectButton
            options={[
                { value: 'normal', label: 'Normal text' },
                { value: 'title', label: 'Title' },
                { value: 'subtitle', label: 'Subtitle' },
                { value: 'heading1', label: 'Heading 1' },
                { value: 'heading2', label: 'Heading 2' },
                { value: 'heading3', label: 'Heading 3' },
            ]}
            width={120}
            value={'normal'}
            onChange={(newVariant) => null}
        />
    );
};

export default VariantButton;
