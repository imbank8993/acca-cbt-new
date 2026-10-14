'use client';

import React from 'react';
import { DatePicker } from './DatePicker';
import { TimeField } from './TimeField';
import { TimeTextField } from './TimeTextField';
import { DEFAULT_SCHOOL_TIME_ZONE, utcToSchoolLocalDateTime } from '@/lib/school-time';

export interface DateTimePickerProps {
    value: string; // 'YYYY-MM-DDTHH:mm' or ''
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    minDate?: string;
    maxDate?: string;
    defaultTime?: string;
    timeZone?: string;
    className?: string;
    timeInputMode?: 'picker' | 'text';
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
    defaultTime = '08:00',
    timeZone = DEFAULT_SCHOOL_TIME_ZONE,
    className = '',
    timeInputMode = 'picker',
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

    const lastDatePartRef = React.useRef<string>('');
    React.useEffect(() => {
        if (datePart) {
            lastDatePartRef.current = datePart;
        }
    }, [datePart]);

    const handleDateChange = (newDate: string) => {
        if (!newDate) {
            lastDatePartRef.current = '';
            onChange('');
            return;
        }
        lastDatePartRef.current = newDate;
        const time = timePart || defaultTime || '08:00';
        onChange(`${newDate}T${time}`);
    };

    const handleTimeChange = (newTime: string) => {
        if (!newTime) {
            if (timeInputMode === 'text') onChange(datePart || lastDatePartRef.current);
            return;
        }
        const effectiveDate = datePart || lastDatePartRef.current || utcToSchoolLocalDateTime(new Date().toISOString(), timeZone).slice(0, 10);
        onChange(`${effectiveDate}T${newTime}`);
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
            <div className="w-[124px] sm:w-[130px] shrink-0">
                {timeInputMode === 'text' ? (
                    <TimeTextField value={timePart} onChange={handleTimeChange} label={label} disabled={disabled} required={required} />
                ) : (
                <TimeField
                    value={timePart}
                    onChange={handleTimeChange}
                    label={label}
                    disabled={disabled}
                    timeZone={timeZone}
                />
                )}
            </div>
        </div>
    );
}

export default DateTimePicker;
