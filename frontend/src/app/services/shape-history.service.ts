import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ShapeHistoryItem {
  shape_id: string;
  direction_id: string;
  direction_label: string;
  route_short_name: string;
  route_long_name: string;
  service_id?: string;
  agency_id: string;
  feed_start_date: string | null;
  feed_end_date: string | null;
  vigente: boolean;
  coordinates: [number, number][];
  num_coords: number;
  geom_points?: number;
  geom_warning: boolean;
  start_pt?: [number, number] | null;
  end_pt?: [number, number] | null;
}

export interface ShapeHistoryApiResponse {
  route_short_name: string;
  total: number;
  items: ShapeHistoryItem[];
  ida: ShapeHistoryItem[];
  volta: ShapeHistoryItem[];
}

@Injectable({
  providedIn: 'root'
})
export class ShapeHistoryService {
  private readonly baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getShapeHistory(routeShortName: string): Observable<ShapeHistoryApiResponse> {
    return this.http.get<ShapeHistoryApiResponse>(
      `${this.baseUrl}/shapes/history?route_short_name=${encodeURIComponent(routeShortName)}`
    );
  }
}