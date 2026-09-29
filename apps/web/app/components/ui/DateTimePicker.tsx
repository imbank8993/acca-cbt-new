'use client';

import React from 'react';
import { DatePicker } from './DatePicker';
import { TimeField } from './TimeField';

export interface DateTimePickerProps {
    value: string; // 'YYYY-MM-DDTHH:mm' or ''
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    minDate?: string;
    maxDate?: string;
    className?: string;
}

export function DateTimePicker({
    value,
    onChange,
    label = 'Waktu',
    placeholder = 'dd/mm/yyyy',
    disabled = false,
    required = false,
    minDate,
    maxDate,
    className = '',
}: DateTimePickerProps) {
    let datePart = '';
    let timePart = '';

    if (value) {
        if (value.includes('T')) {
            const [d, t] = value.split('T');
            datePart = d || '';
            timePart = (t || '').slice(0, 5);
        } else if (value.includes(' ')) {
            const [d, t] = value.split(' ');
            datePart = d || '';
            timePart = (t || '').slice(0, 5);
        } else {
            datePart = value.slice(0, 10);
        }
    }

    const handleDateChange = (newDate: string) => {
        if (!newDate) {
            onChange('');
            return;
        }
        const time = timePart || '08:00';
        onChange(`${newDate}T${time}`);
    };

    const handleTimeChange = (newTime: string) => {
        if (!newTime) return;
        const date = datePart || new Date().toISOString().slice(0, 10);
        onChange(`${date}T${newTime}`);
    };

    return (
        <div className={`flex items-center gap-2 w-full ${className}`}>
            <div className="flex-1 min-w-0">
                <DatePicker
                    value={datePart}
                    onChange={handleDateChange}
                    placeholder={placeholder}
                    disabled={disabled}
                    required={required}
                    min={minDate}
                    max={maxDate}
                />
            </div>
            <div className="w-[124px] shrink-0">
                <TimeField
                    value={timePart}
                    onChange={handleTimeChange}
                    label={label}
                    disabled={disabled}
                />
            </div>
        </div>
    );
}

export default DateTimePicker;
