# Checklist realtime publico (CRM -> web)

## 1) Variables de entorno

En el frontend (Astro) debes tener:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_CRM_ORGANIZATION_ID` (recomendado) o `CRM_ORGANIZATION_ID`

Nota:
- Sin `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`, el script realtime no se carga.

## 2) Ejecutar migracion SQL

Ejecuta:

- `supabase/sql/004_public_catalog_realtime.sql`

Esta migracion hace:

1. `grant usage` del schema `crm` a `anon`.
2. `grant select` de `crm.properties` a `anon`.
3. Policy `public_catalog_properties_select` para lectura anonima solo de filas publicas.
4. `alter table crm.properties replica identity full`.
5. Añade `crm.properties` a `publication supabase_realtime` (si no estaba).

## 3) Verificaciones SQL en Supabase

Comprobar policy activa:

```sql
select policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'crm'
  and tablename = 'properties';
```

Comprobar que la tabla esta en realtime publication:

```sql
select p.pubname, n.nspname as schema_name, c.relname as table_name
from pg_publication p
join pg_publication_rel pr on pr.prpubid = p.oid
join pg_class c on c.oid = pr.prrelid
join pg_namespace n on n.oid = c.relnamespace
where p.pubname = 'supabase_realtime'
  and n.nspname = 'crm'
  and c.relname = 'properties';
```

## 4) Prueba funcional end-to-end

1. Abrir la web publica en una ficha o listado.
2. En CRM, editar una propiedad publica (`is_public=true`) y guardar.
3. Verificar que la web se refresca sola sin reload manual.

## 5) Si no refresca

1. Revisar que la fila cumple la policy (`is_public=true`, no `private`, no `archived`).
2. Revisar consola del navegador por errores de websocket/realtime.
3. Confirmar que `PUBLIC_SUPABASE_ANON_KEY` pertenece al mismo proyecto que `PUBLIC_SUPABASE_URL`.
4. Confirmar que la tabla sigue en `supabase_realtime`.

