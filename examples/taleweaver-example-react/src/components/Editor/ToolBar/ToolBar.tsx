import React from 'react';
import Box from 'ui-box';
import ButtonGroup from './ButtonGroup';
import ColorButton from './ColorButton';
import FamilyButton from './FamilyButton';
import ItalicButton from './ItalicButton';
import SizeButton from './SizeButton';
import StrikethroughButton from './StrikethroughButton';
import UnderlineButton from './UnderlineButton';
import VariantButton from './VariantButton';
import WeightButton from './WeightButton';

const ToolBar: React.FC = () => {
    return (
        <Box position="sticky" top={0} zIndex={10}>
            <Box
                display="flex"
                marginY={0}
                marginX="auto"
                width={816}
                background="white"
                boxShadow="0 1px 3px rgba(0, 0, 0, 0.09)"
            >
                <ButtonGroup>
                    <VariantButton />
                </ButtonGroup>
                <ButtonGroup>
                    <FamilyButton />
                </ButtonGroup>
                <ButtonGroup>
                    <SizeButton />
                </ButtonGroup>
                <ButtonGroup>
                    <WeightButton />
                    <ItalicButton />
                    <UnderlineButton />
                    <StrikethroughButton />
                    <ColorButton />
                </ButtonGroup>
            </Box>
        </Box>
    );
};

export default ToolBar;
