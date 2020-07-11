import styled from 'styled-components';

const ButtonGroup = styled.div`
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

export default ButtonGroup;
