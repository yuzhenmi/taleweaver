import styled from 'styled-components';

interface IProps {
    disabled: boolean;
    active: boolean;
}

const ToggleButton = styled.button<IProps>`
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 36px;
    height: 36px;
    font-size: 18px;
    position: relative;
    color: rgba(0, 0, 0, 0.85);
    background: transparent;
    padding: 0;
    border: none;
    border-radius: 3px;
    outline: none;
    &:after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 3px;
        right: 3px;
        height: 3px;
    }
    &:hover {
        background: rgba(0, 0, 0, 0.04);
    }
    ${({ disabled }) =>
        disabled &&
        `
    opacity: 0.45;
    &:hover,
    &:focus {
        background: transparent;
    }
`}
    ${({ active }) =>
        active &&
        `
    color: rgba(255, 0, 0, 1);
    &:after {
        background: rgba(255, 0, 0, 1);
    }
`}
`;

export default ToggleButton;
