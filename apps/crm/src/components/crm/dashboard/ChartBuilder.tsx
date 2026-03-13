import React, { useState, useEffect } from 'react';
import type { ChartConfig } from './DashboardContainer';
import { X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';

interface Props {
  onClose: () => void;
  onAdd: (config: ChartConfig) => void;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export const ChartBuilder: React.FC<Props> = ({ onClose, onAdd }) => {
  const [type, setType] = useState<'bar' | 'pie' | 'line'>('bar');
  const [field, setField] = useState('status');
  const [title, setTitle] = useState('Leads por Estado');
  const [previewData, setPreviewData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPreview = async () => {
      const orgId = localStorage.getItem('crm.organization_id') || '';
      if (!orgId) return;

      setLoading(true);
      try {
        const resp = await fetch(`/api/v1/crm/dashboard/stats?organization_id=${orgId}&field=${field}`);
        const payload = await resp.json();
        if (payload.ok) {
          setPreviewData(payload.data);
        }
      } catch (err) {
        console.error('Preview fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchPreview, 500);
    return () => clearTimeout(timeoutId);
  }, [field]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({
      id: `chart_${Date.now()}`,
      type,
      field,
      title,
    });
  };

  return (
    <div className="crm-modal-overlay">
      <div className="crm-modal crm-chart-builder">
        <div className="crm-modal-header">
          <h2>Crear nuevo gráfico</h2>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="crm-chart-builder-content">
          <form className="crm-form" onSubmit={handleSubmit}>
            <label>Título del gráfico
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required />
            </label>
            <label>Tipo de gráfico
              <select value={type} onChange={e => setType(e.target.value as any)}>
                <option value="bar">Barras</option>
                <option value="pie">Circular (Donut)</option>
                <option value="line">Línea</option>
              </select>
            </label>
            <label>Campo de datos (de la tabla leads)
              <select value={field} onChange={e => setField(e.target.value)}>
                <option value="status">Estado</option>
                <option value="origin_type">Origen (Tipo)</option>
                <option value="lead_kind">Tipo de Lead</option>
                <option value="operation_interest">Interés (Venta/Alquiler)</option>
                <option value="nationality">Nacionalidad</option>
                <option value="source">Fuente</option>
              </select>
            </label>
            <div style={{ marginTop: '1.5rem' }}>
              <button type="submit" className="crm-button">Añadir al Dashboard</button>
            </div>
          </form>

          <div className="crm-chart-preview">
            <h3>Vista previa</h3>
            <div className="crm-preview-box">
              {loading ? (
                <div className="crm-loading">Cargando...</div>
              ) : previewData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  {type === 'bar' ? (
                    <BarChart data={previewData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={10} />
                      <Bar dataKey="value" fill="#3B82F6" />
                    </BarChart>
                  ) : type === 'pie' ? (
                    <PieChart>
                      <Pie data={previewData} innerRadius={40} outerRadius={60} dataKey="value">
                        {previewData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  ) : (
                    <div className="crm-empty">Línea (Preview)</div>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="crm-empty">Sin datos para previsualizar</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
