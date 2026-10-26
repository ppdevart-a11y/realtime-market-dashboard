import type { Routes } from '@angular/router';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { SettingsPage } from './features/settings/settings-page';

// Eager on purpose: two small pages gain little from lazy loading, and a tab opened before a
// deploy would fail to fetch the replaced chunks on its next navigation.
export const routes: Routes = [
  { path: '', component: DashboardPage, title: 'Dashboard – Market Monitor' },
  { path: 'settings', component: SettingsPage, title: 'Settings – Market Monitor' },
  { path: '**', redirectTo: '' },
];
