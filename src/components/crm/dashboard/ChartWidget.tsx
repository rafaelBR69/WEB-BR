import React, { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { Trash2, GripVertical } from 'lucide-react';
import type { ChartConfig } from './DashboardContainer';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

interface Props {
  config: ChartConfig;
  onRemove: () => void;
  organizationId: string;
}

export const ChartWidget: React.FC<Props> = ({ config, onRemove, organizationId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: config.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const resp = await fetch(
          `/api/v1/crm/dashboard/stats?organization_id=${organizationId}&field=${config.field}`
        );
        const payload = await resp.json();
        if (payload.ok) {
          setData(payload.data);
        }
      } catch (err) {
        console.error('Failed to fetch chart data:', err);
      } finally {
        setLoading(false);
      }
    };

    if (organizationId && config.field) {
      fetchData();
    }
  }, [organizationId, config.field]);

  const renderChart = () => {
    if (loading) return <div className="crm-loading">Cargando datos...</div>;
    if (!data.length) return <div className="crm-empty">No hay datos suficientes</div>;

    if (config.type === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (config.type === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (config.type === 'line') {
        return (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          );
    }

    return null;
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`crm-card crm-chart-widget ${isDragging ? 'is-dragging' : ''}`}
    >
      <div className="crm-chart-header">
        <div className="crm-chart-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </div>
        <h3>{config.title}</h3>
        <button className="crm-chart-remove" onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="crm-chart-body">
        {renderChart()}
      </div>
    </article>
  );
};
