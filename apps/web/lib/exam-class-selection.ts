import type { OrganizationClass } from './api/proctor';

export function currentRegularClasses(classes: OrganizationClass[], activeYear: string | null): OrganizationClass[] {
    if (!activeYear) return [];
    const normalize = (year: string) => year.trim().replace(/\s+/g, '').replace(/-/g, '/');
    const grade = (name: string) => ({ X: 10, XI: 11, XII: 12 }[name.trim().split(/\s+/)[0].toUpperCase()] ?? 99);
    return classes.filter(cls => cls.type === 'reguler' && cls.school_year && normalize(cls.school_year) === normalize(activeYear))
        .sort((a,b) => grade(a.name) - grade(b.name) || a.name.localeCompare(b.name, 'id', { numeric:true, sensitivity:'base' }) || a.id.localeCompare(b.id));
}
