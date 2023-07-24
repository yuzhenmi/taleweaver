import styled from 'styled-components';

const ButtonGroup = styled.div`
    flex: 0 0 auto;
    display: flex;
    border-radius: 4px;
    padding: 4px;
    position: relative;
    & + &::before {
        content: '';
        position: absolute;
        top: 8px;
        bottom: 8px;
        left: 0;
        width: 1px;
        background: rgba(0, 0, 0, 0.09);
    }
`;

export default ButtonGroup;
