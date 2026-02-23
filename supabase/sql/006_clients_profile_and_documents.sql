-- Fase 1 del modulo clientes:
-- - perfil comercial ampliado en crm.clients
-- - indices para listados y documentos cliente

alter table crm.clients
add column if not exists profile_data jsonb not null default '{}'::jsonb;

create index if not exists idx_clients_org_status on crm.clients (organization_id, client_status);
create index if not exists idx_clients_org_type on crm.clients (organization_id, client_type);
create index if not exists idx_documents_client_id on crm.documents (client_id);

