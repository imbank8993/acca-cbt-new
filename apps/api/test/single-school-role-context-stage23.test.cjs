// Run from repository root: node apps/api/test/single-school-role-context-stage23.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('SCHOOL-ROLE-01: endpoint konteks peran per sekolah telah dihapus', () => {
    const controller = read('apps/api/src/auth/auth.controller.ts');
    const service = read('apps/api/src/auth/auth.service.ts');
    assert.doesNotMatch(controller, /role-contexts|listRoleContexts/);
    assert.doesNotMatch(service, /listRoleContexts|interface RoleContext|orgName/);
    assert.equal(fs.existsSync(path.join(root, 'apps/web/app/api/auth/role-contexts/route.ts')), false);
});

test('SCHOOL-ROLE-02: konteks UI hanya membawa peran', () => {
    const rbac = read('apps/web/lib/rbac.ts');
    const sidebar = read('apps/web/app/components/Sidebar.tsx');
    assert.match(rbac, /interface UserRoleContext\s*{\s*role: Role;\s*}/);
    assert.doesNotMatch(rbac, /getUserRolesWithOrg|getRoleContexts/);
    assert.doesNotMatch(sidebar, /orgId|orgName|availableRoles|onRoleSwitch/);
});

test('SCHOOL-ROLE-03: layout memakai peran hasil sesi tanpa permintaan kedua', () => {
    const layout = read('apps/web/app/dashboard/layout.tsx');
    assert.match(layout, /getUserRoleContexts\(user\.resolved\)/);
    assert.match(layout, /pathRole\s*&&\s*isRoleQualifiedFromList/);
    assert.doesNotMatch(layout, /getUserRolesWithOrg|rolesWithOrg|role-contexts/);
});

test('SCHOOL-ROLE-04: komponen operasional tidak lagi menerima orgId yang tak dipakai', () => {
    for (const relative of [
        'apps/web/app/components/questions/BulkImportModal.tsx',
        'apps/web/app/components/questions/DimensionManager.tsx',
        'apps/web/app/components/questions/InstructionManager.tsx',
        'apps/web/app/components/questions/KisiKisiTab.tsx',
        'apps/web/app/components/questions/StimulusManager.tsx',
        'apps/web/app/dashboard/admin/pas/RoomManagementModal.tsx',
        'apps/web/app/dashboard/proktor/pas/RoomManagementModal.tsx',
    ]) {
        assert.doesNotMatch(read(relative), /\borgId\b/, relative);
    }
});
