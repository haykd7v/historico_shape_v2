// ============================================================
// 🔹 COMPONENTE PRINCIPAL - HISTÓRICO DE SHAPES
// ============================================================
// Responsável por:
// - buscar dados da API
// - controlar estado da tela
// - renderizar mapa (Leaflet)
// - comparar versões de shape
//
// IMPORTANTE:
// - Backend já entrega dados prontos
// - Frontend NÃO faz deduplicação
// ============================================================


import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, ChangeDetectorRef
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as L from 'leaflet';

import {
  ShapeHistoryService,
  ShapeHistoryItem,
  ShapeHistoryApiResponse,
} from '../services/shape-history.service';

// ============================================================
// 🔹 ESTADO DA APLICAÇÃO
// ============================================================
// Variáveis que controlam:
// - dados da API
// - seleção atual
// - comparação
// - estado de loading/erro
// ============================================================

@Component({
  selector: 'app-shape-history',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './shape-history.component.html',
  styleUrls: ['./shape-history.component.scss'],
})
export class ShapeHistoryComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;

  searchCtrl    = new FormControl('');
  activeTab: '0' | '1' = '0';

  historyData: ShapeHistoryApiResponse | null = null;

  dedupedIda:   ShapeHistoryItem[] = [];
  dedupedVolta: ShapeHistoryItem[] = [];

  selectedIda:   ShapeHistoryItem | null = null;
  selectedVolta: ShapeHistoryItem | null = null;
  compareIda:    ShapeHistoryItem | null = null;
  compareVolta:  ShapeHistoryItem | null = null;

  loading        = false;
  loadingCompare = false;
  error          = '';

  diffAdded:     [number,number][] = [];
  diffRemoved:   [number,number][] = [];
  diffUnchanged: [number,number][] = [];

  private map!: L.Map;
  private currentLayer?: L.Polyline;
  private compareLayer?: L.Polyline;
  private addedMarkers:   L.CircleMarker[] = [];
  private removedMarkers: L.CircleMarker[] = [];

  private endpointMarkers: (L.Circle | L.CircleMarker)[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private svc: ShapeHistoryService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.searchCtrl.valueChanges.pipe(
      debounceTime(800),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(val => {
      const v = (val || '').trim();
      if (v.length >= 3) this.buscarLinha(v);
    });
  }

  ngAfterViewInit() {
    this.initMap();
  }

  private initMap() {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [-22.9068, -43.1729],
      zoom: 12,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);
  }

// ============================================================
// 🔹 BUSCA DE DADOS
// ============================================================
// Fluxo:
// 1. limpa estado anterior
// 2. chama API
// 3. separa ida/volta
// 4. define seleção inicial
// 5. renderiza mapa
// ============================================================


  private buscarLinha(routeShortName: string) {
    this.loading      = true;
    this.error        = '';
    this.historyData  = null;
    this.dedupedIda   = [];
    this.dedupedVolta = [];
    this.selectedIda  = this.selectedVolta = null;
    this.compareIda   = this.compareVolta  = null;
    this.resetDiff();
    this.clearLayers();

    this.svc.getShapeHistory(routeShortName).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: data => {
        this.historyData  = data;
        this.dedupedIda   = data.ida;
        this.dedupedVolta = data.volta;

        this.selectedIda   = this.dedupedIda.find(i => i.vigente)   ?? this.dedupedIda[0]   ?? null;
        this.selectedVolta = this.dedupedVolta.find(i => i.vigente) ?? this.dedupedVolta[0] ?? null;

        this.loading = false;
        this.renderShapes();
        this.cdr.markForCheck();
      },
      error: err => {
        this.error   = err?.error?.detail ?? 'Erro ao buscar shapes.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private dedupe(items: ShapeHistoryItem[]): ShapeHistoryItem[] {
    const map = new Map<string, ShapeHistoryItem>();

    for (const item of items) {
      const existing = map.get(item.shape_id);
      if (!existing) {
        map.set(item.shape_id, item);
        continue;
      }
      if (item.vigente && !existing.vigente) {
        map.set(item.shape_id, item);
        continue;
      }
      if (!item.vigente && !existing.vigente) {
        const dateA = item.feed_start_date ?? '';
        const dateB = existing.feed_start_date ?? '';
        if (dateA > dateB) map.set(item.shape_id, item);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.vigente !== b.vigente) return a.vigente ? -1 : 1;
      return (b.feed_start_date ?? '') > (a.feed_start_date ?? '') ? 1 : -1;
    });
  }

  // ── Helpers de coordenadas ────────────────────────────────────

  /** Garante que coordinates é sempre um array válido, nunca null/undefined */
  private safeCoords(item: ShapeHistoryItem): [number, number][] {
    return Array.isArray(item?.coordinates) ? item.coordinates : [];
  }


  // ============================================================
// 🔹 RENDERIZAÇÃO DO MAPA
// ============================================================
// Responsável por:
// - desenhar shape selecionado
// - aplicar fallback se for stub
//
// IMPORTANTE:
// Se shape atual for inválido,
// tenta usar outro shape válido da mesma direção
// ============================================================
  // parsePoint removido — backend já envia start_pt/end_pt como [lat, lon]

  // ── Seleção de versão ────────────────────────────────────────
  selectVersion(item: ShapeHistoryItem) {
    if (item.direction_id === '0') {
      this.selectedIda = item;
      this.compareIda  = null;
    } else {
      this.selectedVolta = item;
      this.compareVolta  = null;
    }
    this.resetDiff();
    this.clearLayers();
    this.renderShapes();
  }

  selectCompare(item: ShapeHistoryItem | null, direction: '0' | '1') {
    if (direction === '0') this.compareIda   = item;
    else                   this.compareVolta = item;

    this.resetDiff();
    this.clearLayers();
    this.renderShapes();

    const selected = direction === '0' ? this.selectedIda : this.selectedVolta;
    const compare  = direction === '0' ? this.compareIda  : this.compareVolta;
    if (selected && compare) this.computeDiff(selected, compare);
  }

  onCompareChange(event: Event, direction: '0' | '1') {
    const val = (event.target as HTMLSelectElement).value;
    if (!val) { this.selectCompare(null, direction); return; }
    const list  = direction === '0' ? this.dedupedIda : this.dedupedVolta;
    const found = list.find(i => i.shape_id === val) ?? null;
    this.selectCompare(found, direction);
  }

  // ── Diff ─────────────────────────────────────────────────────
  private computeDiff(a: ShapeHistoryItem, b: ShapeHistoryItem) {
    const coordsA = this.safeCoords(a);
    const coordsB = this.safeCoords(b);

    const setA = new Set(coordsA.map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`));
    const setB = new Set(coordsB.map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`));

    this.diffAdded     = coordsA.filter(c => !setB.has(`${c[0].toFixed(5)},${c[1].toFixed(5)}`));
    this.diffRemoved   = coordsB.filter(c => !setA.has(`${c[0].toFixed(5)},${c[1].toFixed(5)}`));
    this.diffUnchanged = coordsA.filter(c =>  setB.has(`${c[0].toFixed(5)},${c[1].toFixed(5)}`));

    this.renderDiffMarkers();
    this.cdr.markForCheck();
  }

  private resetDiff() {
    this.diffAdded = this.diffRemoved = this.diffUnchanged = [];
  }

  // ── Mapa ─────────────────────────────────────────────────────
  private renderShapes() {
    const selected = this.activeTab === '0' ? this.selectedIda : this.selectedVolta;
    const compare  = this.activeTab === '0' ? this.compareIda  : this.compareVolta;

    const selectedCoords = this.safeCoords(selected!);

    // Se o shape selecionado for stub (geom_warning), tenta usar o primeiro com geometria válida
    let effectiveSelected = selected;
    if (selected?.geom_warning) {
      const list = this.activeTab === '0' ? this.dedupedIda : this.dedupedVolta;
      const fallback = list.find(i => !i.geom_warning);
      if (fallback) {
        effectiveSelected = fallback;
        console.warn(
          `[ShapeHistory] Shape vigente ${selected.shape_id} tem geometria incompleta ` +
          `(${selected.coordinates?.length ?? 0} pts). Exibindo ${fallback.shape_id} como fallback.`
        );
      }
    }

    const effectiveCoords = this.safeCoords(effectiveSelected!);

    if (effectiveCoords.length) {
      this.currentLayer = L.polyline(effectiveCoords, {
        color: '#378ADD', weight: 4, opacity: 0.9
      }).addTo(this.map);

      let bounds = this.currentLayer.getBounds();

      const compareCoords = this.safeCoords(compare!);
      if (compareCoords.length) {
        this.compareLayer = L.polyline(compareCoords, {
          color: '#E24B4A', weight: 3, opacity: 0.6, dashArray: '6,4'
        }).addTo(this.map);
        bounds = bounds.extend(this.compareLayer.getBounds());
      }

      this.map.fitBounds(bounds, { padding: [24, 24] });

      // Renderiza start/end points do shape efetivo
      if (effectiveSelected) this.renderEndpoints(effectiveSelected);
    }
  }

  /** Renderiza os buffers de 500 m de início e fim da viagem usando L.circle (raio em metros)
 *  e uma bolinha no centro de cada buffer.
 */
private renderEndpoints(item: ShapeHistoryItem) {
  const start = item.start_pt;
  const end   = item.end_pt;

  if (start) {
    const startBuffer = L.circle(start, {
      radius: 500,
      color: '#1D9E75',
      fillColor: '#1D9E75',
      fillOpacity: 0.15,
      weight: 2,
    }).bindPopup(`<b>Início (buffer 500 m)</b><br>${start[0].toFixed(5)}, ${start[1].toFixed(5)}`);

    const startDot = L.circleMarker(start, {
      radius: 6,
      color: '#1D9E75',
      fillColor: '#1D9E75',
      fillOpacity: 1,
      weight: 2,
    }).bindPopup(`<b>Início da viagem</b><br>${start[0].toFixed(5)}, ${start[1].toFixed(5)}`);

    startBuffer.addTo(this.map);
    startDot.addTo(this.map);

    this.endpointMarkers.push(startBuffer, startDot);
  }

  if (end) {
    const endBuffer = L.circle(end, {
      radius: 500,
      color: '#E24B4A',
      fillColor: '#E24B4A',
      fillOpacity: 0.15,
      weight: 2,
    }).bindPopup(`<b>Fim (buffer 500 m)</b><br>${end[0].toFixed(5)}, ${end[1].toFixed(5)}`);

    const endDot = L.circleMarker(end, {
      radius: 6,
      color: '#E24B4A',
      fillColor: '#E24B4A',
      fillOpacity: 1,
      weight: 2,
    }).bindPopup(`<b>Fim da viagem</b><br>${end[0].toFixed(5)}, ${end[1].toFixed(5)}`);

    endBuffer.addTo(this.map);
    endDot.addTo(this.map);

    this.endpointMarkers.push(endBuffer, endDot);
  }
}

  private renderDiffMarkers() {
    this.diffAdded.forEach(c => {
      const m = L.circleMarker(c, {
        radius: 6, color: '#1D9E75', fillColor: '#1D9E75', fillOpacity: 0.9, weight: 2
      }).bindPopup(`<b>Adicionado</b><br>${c[0].toFixed(5)}, ${c[1].toFixed(5)}`);
      m.addTo(this.map);
      this.addedMarkers.push(m);
    });
    this.diffRemoved.forEach(c => {
      const m = L.circleMarker(c, {
        radius: 6, color: '#E24B4A', fillColor: '#E24B4A', fillOpacity: 0.9, weight: 2
      }).bindPopup(`<b>Removido</b><br>${c[0].toFixed(5)}, ${c[1].toFixed(5)}`);
      m.addTo(this.map);
      this.removedMarkers.push(m);
    });
  }

  private clearLayers() {
    if (this.currentLayer) this.map.removeLayer(this.currentLayer);
    if (this.compareLayer) this.map.removeLayer(this.compareLayer);
    this.addedMarkers.forEach(m => this.map.removeLayer(m));
    this.removedMarkers.forEach(m => this.map.removeLayer(m));
    this.endpointMarkers.forEach(m => this.map.removeLayer(m));
    this.addedMarkers = []; this.removedMarkers = []; this.endpointMarkers = [];
    this.currentLayer = undefined; this.compareLayer = undefined;
  }

  // ── Tabs ─────────────────────────────────────────────────────
  setTab(tab: '0' | '1') {
    this.activeTab = tab;
    this.clearLayers();
    this.resetDiff();
    this.renderShapes();
    if (tab === '0' && this.compareIda)   this.computeDiff(this.selectedIda!, this.compareIda);
    if (tab === '1' && this.compareVolta) this.computeDiff(this.selectedVolta!, this.compareVolta);
  }

  // ── Helpers ──────────────────────────────────────────────────
  get currentVersions(): ShapeHistoryItem[] {
    return this.activeTab === '0' ? this.dedupedIda : this.dedupedVolta;
  }

  get selectedVersion(): ShapeHistoryItem | null {
    return this.activeTab === '0' ? this.selectedIda : this.selectedVolta;
  }

  get compareVersion(): ShapeHistoryItem | null {
    return this.activeTab === '0' ? this.compareIda : this.compareVolta;
  }

  get idaCount():   number { return this.dedupedIda.length; }
  get voltaCount(): number { return this.dedupedVolta.length; }

  formatDate(d: string | null): string {
    if (!d) return 'vigente';
    return new Date(d).toLocaleDateString('pt-BR');
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.map) this.map.remove();
  }
}