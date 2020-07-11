import React from 'react';
import styled from 'styled-components';

interface ISelectProps {
    width: number;
}

const Select = styled.select<ISelectProps>`
    -webkit-appearance: none;
    border: none;
    font-size: 12px;
    font-weight: 500;
    width: ${({ width }) => width}px;
    background: white;
    border-radius: 3px;
    padding: 0 9px;
    outline: none;
    position: relative;
    &:hover,
    &:focus {
        background: rgba(0, 0, 0, 0.04);
    }
    option {
        color: rgba(0, 0, 0, 0.85);
    }
`;

interface IOption {
    value: string;
    label?: string;
}

interface IProps {
    options: IOption[];
    width: number;
    value: string;
    onChange: (value: string) => any;
}

const SelectButton: React.FC<IProps> = ({ options, width, value, onChange }) => {
    return (
        <Select width={width} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="" hidden />
            {options.map((option, optionIndex) => (
                <option key={optionIndex} value={option.value}>
                    {option.label ?? option.value}
                </option>
            ))}
        </Select>
    );
};

export default SelectButton;
