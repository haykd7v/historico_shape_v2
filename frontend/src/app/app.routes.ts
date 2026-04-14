import { Routes } from '@angular/router';
import { ShapeHistoryComponent } from './shape-history/shape-history.component';

export const routes: Routes = [
  { path: '', component: ShapeHistoryComponent },
  { path: '**', redirectTo: '' }
];
