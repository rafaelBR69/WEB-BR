import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { ChartWidget } from './ChartWidget';
import { ChartBuilder } from './ChartBuilder';
import { Plus } from 'lucide-react';

export interface ChartConfig {
  id: string;
  type: 'bar' | 'pie' | 'line';
  field: string;
  title: string;
}

export const DashboardContainer: React.FC = () => {
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const localOrgId = localStorage.getItem('crm.organization_id');
    const defaultOrgId = (window as any).__crmDefaultOrganizationId;
    const orgId = localOrgId || defaultOrgId || '';
    
    setOrganizationId(orgId);
    if (orgId) {
      loadDashboard(orgId);
    }
  }, []);

  const loadDashboard = async (orgId: string) => {
    try {
      const resp = await fetch(`/api/v1/crm/dashboard/config?organization_id=${orgId}`);
      const payload = await resp.json();
      if (payload.ok) {
        setCharts(payload.data || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  };

  const saveDashboard = async (newCharts: ChartConfig[]) => {
    try {
      await fetch('/api/v1/crm/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, config: newCharts }),
      });
    } catch (err) {
      console.error('Failed to save dashboard:', err);
    }
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCharts((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        const newArray = arrayMove(items, oldIndex, newIndex);
        saveDashboard(newArray);
        return newArray;
      });
    }
  };

  const addChart = (config: ChartConfig) => {
    const newCharts = [...charts, config];
    setCharts(newCharts);
    saveDashboard(newCharts);
    setIsBuilderOpen(false);
  };

  const removeChart = (id: string) => {
    const newCharts = charts.filter((c) => c.id !== id);
    setCharts(newCharts);
    saveDashboard(newCharts);
  };

  return (
    <div className="crm-dashboard">
      <div className="crm-actions-row" style={{ marginBottom: '1rem', justifyContent: 'flex-end' }}>
        <button className="crm-button crm-button-soft" onClick={() => setIsBuilderOpen(true)}>
          <Plus size={16} /> Añadir Gráfico
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={charts.map(c => c.id)} strategy={rectSortingStrategy}>
          <div className="crm-dashboard-grid">
            {charts.map((config) => (
              <ChartWidget
                key={config.id}
                config={config}
                onRemove={() => removeChart(config.id)}
                organizationId={organizationId}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {isBuilderOpen && (
        <ChartBuilder
          onClose={() => setIsBuilderOpen(false)}
          onAdd={addChart}
        />
      )}
    </div>
  );
};
