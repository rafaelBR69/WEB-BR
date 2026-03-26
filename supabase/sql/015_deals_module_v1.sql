alter table crm.deals
  drop constraint if exists deals_stage_check;

alter table crm.deals
  add constraint deals_stage_check
  check (stage in ('qualification', 'visit', 'offer', 'negotiation', 'reservation', 'contract', 'won', 'lost'));

create index if not exists idx_deals_org_stage_updated
  on crm.deals (organization_id, stage, updated_at desc);

create index if not exists idx_deals_org_client_updated
  on crm.deals (organization_id, client_id, updated_at desc);

create index if not exists idx_deals_org_lead_updated
  on crm.deals (organization_id, lead_id, updated_at desc);

create index if not exists idx_deals_org_property_updated
  on crm.deals (organization_id, property_id, updated_at desc);
