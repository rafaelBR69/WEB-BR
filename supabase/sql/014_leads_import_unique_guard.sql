-- Evita duplicados tecnicos de importacion CSV por organizacion.
-- Clave: organization_id + raw_payload.import.source_file + raw_payload.import.source_row_number

create unique index if not exists idx_leads_org_import_source_row_unique
on crm.leads (
  organization_id,
  lower(nullif(btrim(raw_payload #>> '{import,source_file}'), '')),
  (
    case
      when (raw_payload #>> '{import,source_row_number}') ~ '^[0-9]+$' then
        case
          when (raw_payload #>> '{import,source_row_number}')::bigint > 0 then
            (raw_payload #>> '{import,source_row_number}')::bigint
          else null
        end
      else null
    end
  )
)
where nullif(btrim(raw_payload #>> '{import,source_file}'), '') is not null
  and (
    case
      when (raw_payload #>> '{import,source_row_number}') ~ '^[0-9]+$' then
        case
          when (raw_payload #>> '{import,source_row_number}')::bigint > 0 then
            (raw_payload #>> '{import,source_row_number}')::bigint
          else null
        end
      else null
    end
  ) is not null;
